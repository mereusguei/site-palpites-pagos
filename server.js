require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const JWT_SECRET = process.env.JWT_SECRET || 'sua-chave-secreta-super-dificil-de-adivinhar-123';

app.use(cors());
app.use(express.json());

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Middleware de verificação de Admin
const verifyAdmin = async (req, res, next) => {
    try {
        const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0 || !userResult.rows[0].is_admin) {
            return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

// Rota Raiz
app.get('/', (req, res) => res.send('<h1>API do Octagon Oracle está no ar!</h1>'));

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const newUserResult = await pool.query('INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username', [username, email, password_hash]);
        res.status(201).json({ message: 'Usuário cadastrado com sucesso!', user: newUserResult.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Nome de usuário ou e-mail já cadastrado.' });
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas.' });
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Credenciais inválidas.' });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ message: 'Login bem-sucedido!', token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// --- ROTAS DO USUÁRIO ---
app.get('/api/events/:id', verifyToken, async (req, res) => {
    const { id: eventId } = req.params;
    const userId = req.user.id;
    try {
        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Evento não encontrado.' });
        
        const fightsResult = await pool.query('SELECT * FROM fights WHERE event_id = $1 ORDER BY id', [eventId]);
        
        const picksResult = await pool.query('SELECT * FROM picks WHERE user_id = $1 AND fight_id IN (SELECT id FROM fights WHERE event_id = $2)', [userId, eventId]);
        const userPicks = picksResult.rows.reduce((acc, pick) => { acc[pick.fight_id] = pick; return acc; }, {});

        // --- NOVA PARTE: BUSCA OS PALPITES BÔNUS ---
        const bonusPicksResult = await pool.query(
            'SELECT * FROM bonus_picks WHERE user_id = $1 AND event_id = $2',
            [userId, eventId]
        );
        // Pega o primeiro resultado (só pode haver um) ou um objeto vazio se não houver
        const userBonusPicks = bonusPicksResult.rows[0] || {};

        res.json({ 
            eventName: eventResult.rows[0].name, 
            picksDeadline: eventResult.rows[0].picks_deadline, 
            fights: fightsResult.rows, 
            userPicks,
            userBonusPicks // Envia os palpites bônus para o frontend!
        });
    } catch (error) {
        console.error('Erro ao buscar dados do evento:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do evento.' });
    }
});
app.get('/api/payment-status/:eventId', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { eventId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM payments WHERE user_id = $1 AND event_id = $2 AND status = $3', [userId, eventId, 'PAID']);
        res.json({ hasPaid: result.rows.length > 0 });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar status de pagamento.' });
    }
});
app.post('/api/picks', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { fightId, winnerName, method, details } = req.body;
    if (!fightId || !winnerName || !method || !details) return res.status(400).json({ error: 'Dados do palpite incompletos.' });
    try {
        const query = `
            INSERT INTO picks (user_id, fight_id, predicted_winner_name, predicted_method, predicted_details)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, fight_id) DO UPDATE SET
                predicted_winner_name = EXCLUDED.predicted_winner_name,
                predicted_method = EXCLUDED.predicted_method,
                predicted_details = EXCLUDED.predicted_details
            RETURNING *;`;
        const result = await pool.query(query, [userId, fightId, winnerName, method, details]);
        res.status(201).json({ message: 'Palpite salvo com sucesso!', pick: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar o palpite.' });
    }
});
// ROTA PARA SALVAR PALPITES BÔNUS (ESTAVA FALTANDO)
app.post('/api/bonus-picks', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { eventId, fightOfTheNight, performanceOfTheNight } = req.body;
    const query = `
        INSERT INTO bonus_picks (user_id, event_id, fight_of_the_night_fight_id, performance_of_the_night_fighter_name)
        VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, event_id) DO UPDATE SET
            fight_of_the_night_fight_id = EXCLUDED.fight_of_the_night_fight_id,
            performance_of_the_night_fighter_name = EXCLUDED.performance_of_the_night_fighter_name
        RETURNING *;`;
    try {
        const result = await pool.query(query, [userId, eventId, parseInt(fightOfTheNight), performanceOfTheNight]);
        res.status(201).json({ message: 'Palpites bônus salvos!', pick: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar palpites bônus.' });
    }
});
// ROTA PÚBLICA (PARA USUÁRIOS LOGADOS) PARA O RANKING GERAL
app.get('/api/rankings/general', verifyToken, async (req, res) => {
    try {
        // Esta consulta busca o nome de cada usuário e soma todos os pontos
        // que ele já ganhou em todos os eventos.
        const query = `
    SELECT 
        u.username, 
        COALESCE(SUM(p.points_awarded), 0) as total_points -- COALESCE garante que se a soma for nula, retorne 0
    FROM users u
    LEFT JOIN picks p ON u.id = p.user_id
    WHERE u.is_admin = FALSE
    GROUP BY u.id
    ORDER BY total_points DESC, u.username ASC;
`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar ranking geral:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking geral.' });
    }
});


// --- ROTAS DE PAGAMENTO ---
app.post('/api/create-payment', verifyToken, async (req, res) => {
    const { eventId, eventName } = req.body;
    const userId = req.user.id;
    try {
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [{ id: `evt-${eventId}`, title: `Acesso aos Palpites: ${eventName}`, quantity: 1, unit_price: 0.05, currency_id: 'BRL' }],
                back_urls: { success: 'https://mereusguei.github.io/payment-success.html', failure: 'https://mereusguei.github.io/', pending: 'https://mereusguei.github.io/' },
                auto_return: 'approved',
                metadata: { user_id: userId, event_id: eventId },
                notification_url: `https://site-palpites-pagos.vercel.app/api/payment-webhook`
            }
        });
        res.json({ checkoutUrl: result.init_point });
    } catch (error) {
        res.status(500).json({ error: 'Não foi possível iniciar o pagamento.' });
    }
});
app.post('/api/payment-webhook', async (req, res) => {
    const notification = req.body;
    try {
        if (notification.type === 'payment') {
            const paymentId = notification.data.id;
            const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
            });
            const paymentDetails = await paymentResponse.json();
            if (paymentDetails.status === 'approved' && paymentDetails.metadata) {
                const { user_id, event_id } = paymentDetails.metadata;
                await pool.query('INSERT INTO payments (user_id, event_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user_id, event_id, 'PAID']);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});

// --- ROTA DE ADMIN CORRIGIDA ---
app.post('/api/admin/results', verifyToken, verifyAdmin, async (req, res) => {
    const { resultsArray, realFightOfTheNightId, realPerformanceOfTheNightFighter } = req.body;
    const dbClient = await pool.connect();
    try {
    await dbClient.query('BEGIN');
    let eventId = null;

    if (resultsArray && resultsArray.length > 0) {
        const eventIdResult = await dbClient.query('SELECT event_id FROM fights WHERE id = $1', [resultsArray[0].fightId]);
        if (eventIdResult.rows.length > 0) eventId = eventIdResult.rows[0].event_id;
        for (const result of resultsArray) {
                const { fightId, winnerName, resultMethod, resultDetails } = result;
                await dbClient.query('UPDATE picks SET points_awarded = 0 WHERE fight_id = $1', [fightId]);
                await dbClient.query('UPDATE fights SET winner_name = $1, result_method = $2, result_details = $3 WHERE id = $4', [winnerName, resultMethod, resultDetails, fightId]);
                const picksResult = await dbClient.query('SELECT * FROM picks WHERE fight_id = $1', [fightId]);
                for (const pick of picksResult.rows) {
                    let points = 0;
                    if (pick.predicted_winner_name === winnerName) {
                        points += 20;
                        if (pick.predicted_method === resultMethod) {
                            points += 15;
                            if (pick.predicted_details === resultDetails) { points += 10; }
                        }
                    }
                    await dbClient.query('UPDATE picks SET points_awarded = $1 WHERE id = $2', [points, pick.id]);
                }
            }
        }
        if (realFightOfTheNightId && realPerformanceOfTheNightFighter) {
        if (!eventId) {
            const eventIdResult = await dbClient.query('SELECT event_id FROM fights WHERE id = $1', [realFightOfTheNightId]);
            if (eventIdResult.rows.length > 0) eventId = eventIdResult.rows[0].event_id;
        }
        if (eventId) {
        // Salva os resultados reais dos bônus na tabela de eventos
        await dbClient.query(
            'UPDATE events SET real_fotn_fight_id = $1, real_potn_fighter_name = $2 WHERE id = $3',
            // Se for "NONE", salva NULL no banco, senão salva o valor
            [
                realFightOfTheNightId === 'NONE' ? null : realFightOfTheNightId, 
                realPerformanceOfTheNightFighter === 'NONE' ? null : realPerformanceOfTheNightFighter, 
                eventId
            ]
        );
        
        // Zera os pontos de bônus antes de recalcular
        await dbClient.query('UPDATE bonus_picks SET points_awarded = 0 WHERE event_id = $1', [eventId]);
        const bonusPicksResult = await dbClient.query('SELECT * FROM bonus_picks WHERE event_id = $1', [eventId]);

        for (const bonusPick of bonusPicksResult.rows) {
            let bonusPoints = 0;
            // Só calcula pontos se o bônus real NÃO for "NONE"
            if (realFightOfTheNightId !== 'NONE' && bonusPick.fight_of_the_night_fight_id == realFightOfTheNightId) {
                bonusPoints += 20;
            }
            if (realPerformanceOfTheNightFighter !== 'NONE' && bonusPick.performance_of_the_night_fighter_name === realPerformanceOfTheNightFighter) {
                bonusPoints += 20;
            }
            await dbClient.query('UPDATE bonus_picks SET points_awarded = $1 WHERE id = $2', [bonusPoints, bonusPick.id]);
        }
    }
}
    await dbClient.query('COMMIT'); // Finaliza a transação com sucesso
    res.json({ message: `Apuração concluída com sucesso!` });

} catch (error) {
    await dbClient.query('ROLLBACK'); // Desfaz tudo em caso de erro
    console.error('Erro ao apurar resultados:', error);
    res.status(500).json({ error: 'Erro ao apurar resultados.' });
} finally {
    dbClient.release(); // Libera a conexão com o banco
}
});
// No server.js, adicione esta rota
app.post('/api/bonus-picks', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { eventId, fightOfTheNight, performanceOfTheNight } = req.body;
    
    const query = `
        INSERT INTO bonus_picks (user_id, event_id, fight_of_the_night_fight_id, performance_of_the_night_fighter_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, event_id) DO UPDATE SET
            fight_of_the_night_fight_id = EXCLUDED.fight_of_the_night_fight_id,
            performance_of_the_night_fighter_name = EXCLUDED.performance_of_the_night_fighter_name
        RETURNING *;
    `;
    try {
        const result = await pool.query(query, [userId, eventId, fightOfTheNight, performanceOfTheNight]);
        res.status(201).json({ message: 'Palpites bônus salvos!', pick: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar palpites bônus.' });
    }
});
app.get('/api/admin/all-picks', verifyToken, verifyAdmin, async (req, res) => {
    try {
    const query = `
        SELECT 
            e.id as event_id, e.name as event_name, u.id as user_id, u.username,
            p.id as pick_id, p.fight_id, p.predicted_winner_name, p.predicted_method, 
            p.predicted_details, p.points_awarded, -- Mantemos os pontos individuais aqui
            f.winner_name as real_winner, f.result_method as real_method, f.result_details as real_details,
            bp.fight_of_the_night_fight_id as bonus_fotn_pick,
            bp.performance_of_the_night_fighter_name as bonus_potn_pick
        FROM events e
        LEFT JOIN fights f ON e.id = f.event_id
        LEFT JOIN picks p ON f.id = p.fight_id
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN bonus_picks bp ON u.id = bp.user_id AND e.id = bp.event_id
        WHERE e.id = 1 AND u.is_admin = FALSE
        ORDER BY u.username, p.fight_id;
    `;
    const allData = await pool.query(query);

    // Agora, processamos os dados para calcular o total de pontos
    const results = {};
    for (const row of allData.rows) {
        if (!results[row.event_id]) {
            results[row.event_id] = { eventName: row.event_name, users: {} };
        }
        if (row.user_id && !results[row.event_id].users[row.user_id]) {
            results[row.event_id].users[row.user_id] = {
                username: row.username,
                picks: [],
                bonus_picks: { fotn_fight_id: row.bonus_fotn_pick, potn_fighter: row.bonus_potn_pick },
                stats: { totalPicks: 0, correctWinners: 0, correctMethods: 0, correctDetails: 0, totalPoints: 0 }
            };
        }
        if (row.pick_id) {
            const userEventData = results[row.event_id].users[row.user_id];
            if (!userEventData.picks.some(p => p.pick_id === row.pick_id)) {
                userEventData.picks.push(row);
                const stats = userEventData.stats;
                stats.totalPicks++;
                // A pontuação individual da luta (points_awarded) JÁ ESTÁ EM CADA `row`
                if (row.real_winner) {
                    if (row.predicted_winner_name === row.real_winner) {
                        stats.correctWinners++;
                        if (row.predicted_method === row.real_method) {
                            stats.correctMethods++;
                            if (row.predicted_details === row.real_details) {
                                stats.correctDetails++;
                            }
                        }
                    }
                }
            }
        }
    }

    // Loop final para somar os pontos totais corretamente
    for (const eventId in results) {
        for (const userId in results[eventId].users) {
            const user = results[eventId].users[userId];
            const totalFightPoints = user.picks.reduce((sum, pick) => sum + (pick.points_awarded || 0), 0);
            
            // Precisamos buscar os pontos de bônus separadamente para garantir a soma correta
            const bonusPointsResult = await pool.query('SELECT COALESCE(SUM(points_awarded), 0) as total_bonus FROM bonus_picks WHERE user_id = $1 AND event_id = $2', [userId, eventId]);
            const totalBonusPoints = parseInt(bonusPointsResult.rows[0].total_bonus, 10);
            
            user.stats.totalPoints = totalFightPoints + totalBonusPoints;
        }
    }

    res.json(results);
    } catch (error) {
        console.error('Erro ao buscar todos os palpites:', error);
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});
// ROTA DE ADMIN PARA OS RANKINGS DE PRECISÃO (ACERTO)
app.get('/api/rankings/accuracy', verifyToken, verifyAdmin, async (req, res) => {
    try {
        // Esta é uma consulta mais complexa que calcula tudo de uma vez
        const query = `
    WITH CombinedPoints AS (
        SELECT user_id, points_awarded FROM picks
        UNION ALL
        SELECT user_id, points_awarded FROM bonus_picks
    ),
    UserTotals AS (
        SELECT 
            user_id,
            SUM(points_awarded) as total_points
        FROM CombinedPoints
        GROUP BY user_id
    )
    SELECT
        u.username,
        ut.total_points,
        (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.id) AS total_picks,
        (SELECT COUNT(*) FROM picks p JOIN fights f ON p.fight_id = f.id WHERE p.user_id = u.id AND p.predicted_winner_name = f.winner_name) AS correct_winners,
        (SELECT COUNT(*) FROM picks p JOIN fights f ON p.fight_id = f.id WHERE p.user_id = u.id AND p.predicted_winner_name = f.winner_name AND p.predicted_method = f.result_method) AS correct_methods,
        (SELECT COUNT(*) FROM picks p JOIN fights f ON p.fight_id = f.id WHERE p.user_id = u.id AND p.predicted_winner_name = f.winner_name AND p.predicted_method = f.result_method AND p.predicted_details = f.result_details) AS correct_details,
        (SELECT COUNT(*) FROM bonus_picks bp JOIN events e ON bp.event_id = e.id WHERE bp.user_id = u.id AND bp.fight_of_the_night_fight_id = e.real_fotn_fight_id) AS correct_fotn,
        (SELECT COUNT(*) FROM bonus_picks bp JOIN events e ON bp.event_id = e.id WHERE bp.user_id = u.id AND bp.performance_of_the_night_fighter_name = e.real_potn_fighter_name) AS correct_potn
    FROM users u
    JOIN UserTotals ut ON u.id = ut.user_id
    WHERE u.is_admin = FALSE
    ORDER BY ut.total_points DESC, u.username ASC;
`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar rankings de acerto:', error);
        res.status(500).json({ error: 'Erro ao buscar rankings de acerto.' });
    }
});
// Rota de Admin para buscar a lista de todos os eventos
// Serve para o painel de admin saber quais eventos exibir para apuração.
app.get('/api/admin/events', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM events ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar lista de eventos:', error);
        res.status(500).json({ error: 'Erro ao buscar eventos.' });
    }
});

// Inicia o servidor
app.listen(PORT, async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log(`Servidor rodando na porta ${PORT} e conectado ao banco de dados com sucesso.`);
    } catch (error) {
        console.error('*** FALHA AO CONECTAR AO BANCO DE DADOS ***', error);
    }
});