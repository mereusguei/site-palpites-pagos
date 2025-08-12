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

// Middleware de verificação de Admin
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
        // Criptografa a senha antes de salvar
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // CORREÇÃO: Salva o username e o email sempre em minúsculas
        const newUserResult = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
            [username.toLowerCase(), email.toLowerCase(), password_hash]
        );

        res.status(201).json({
            message: 'Usuário cadastrado com sucesso!',
            user: newUserResult.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Nome de usuário ou e-mail já cadastrado.' });
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
    try {
        // CORREÇÃO: Busca o usuário pelo email em minúsculas
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
        const user = userResult.rows[0];

        // A comparação da senha (bcrypt.compare) já é case-sensitive, o que está correto.
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
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

        // CORREÇÃO: Verifica se a coluna de ordenação existe antes de usá-la
        const columnsResult = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='fights' AND column_name='fight_order'"
        );

        const orderByClause = columnsResult.rows.length > 0
            ? 'ORDER BY fight_order ASC, id ASC'
            : 'ORDER BY id ASC';

        const fightsResult = await pool.query(`SELECT * FROM fights WHERE event_id = $1 ${orderByClause}`, [eventId]);

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
            entry_price: eventResult.rows[0].entry_price, // <-- LINHA ADICIONADA AQUI
            fights: fightsResult.rows,
            userPicks,
            userBonusPicks,
            realFotnFightId: eventResult.rows[0].real_fotn_fight_id,
            realPotnFighterName: eventResult.rows[0].real_potn_fighter_name
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
    if (!fightId || !winnerName || !method || !details) {
        return res.status(400).json({ error: 'Dados do palpite incompletos.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Inicia a transação

        // 1. Salva ou atualiza o palpite do usuário
        const upsertQuery = `
            INSERT INTO picks (user_id, fight_id, predicted_winner_name, predicted_method, predicted_details)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, fight_id) DO UPDATE SET
                predicted_winner_name = EXCLUDED.predicted_winner_name,
                predicted_method = EXCLUDED.predicted_method,
                predicted_details = EXCLUDED.predicted_details
            RETURNING *;`;
        await client.query(upsertQuery, [userId, fightId, winnerName, method, details]);

        // --- NOVA LÓGICA: REAPURAÇÃO EM TEMPO REAL ---

        // 2. Busca o resultado real da luta, se ele existir
        const fightResult = await client.query('SELECT winner_name, result_method, result_details FROM fights WHERE id = $1', [fightId]);

        let points = 0;
        if (fightResult.rows.length > 0 && fightResult.rows[0].winner_name) {
            const realResult = fightResult.rows[0];

            // 3. Compara o palpite com o resultado real e calcula os pontos
            if (winnerName === realResult.winner_name) {
                points += 20;
                if (method === realResult.result_method) {
                    points += 15;
                    if (details === realResult.result_details) {
                        points += 10;
                    }
                }
            }
        }

        // 4. Atualiza a pontuação do palpite com o valor calculado (seja 0 ou mais)
        const finalPickResult = await client.query(
            'UPDATE picks SET points_awarded = $1 WHERE user_id = $2 AND fight_id = $3 RETURNING *',
            [points, userId, fightId]
        );

        await client.query('COMMIT'); // Confirma todas as alterações

        // Retorna o palpite final com a pontuação já calculada
        res.status(201).json({ message: 'Palpite salvo com sucesso!', pick: finalPickResult.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao salvar palpite:', error);
        res.status(500).json({ error: 'Erro ao salvar o palpite.' });
    } finally {
        client.release();
    }
});
// ROTA PARA SALVAR PALPITES BÔNUS (ESTAVA FALTANDO)
app.post('/api/bonus-picks', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { eventId, fightOfTheNight, performanceOfTheNight } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Salva ou atualiza o palpite bônus do usuário
        const upsertQuery = `
            INSERT INTO bonus_picks (user_id, event_id, fight_of_the_night_fight_id, performance_of_the_night_fighter_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, event_id) DO UPDATE SET
                fight_of_the_night_fight_id = EXCLUDED.fight_of_the_night_fight_id,
                performance_of_the_night_fighter_name = EXCLUDED.performance_of_the_night_fighter_name
            RETURNING id;`;
        const upsertResult = await client.query(upsertQuery, [userId, eventId, parseInt(fightOfTheNight), performanceOfTheNight]);
        const bonusPickId = upsertResult.rows[0].id;

        // --- NOVA LÓGICA: REAPURAÇÃO EM TEMPO REAL PARA BÔNUS ---

        // 2. Busca os resultados reais dos bônus para o evento, se existirem
        const eventResult = await client.query(
            'SELECT real_fotn_fight_id, real_potn_fighter_name FROM events WHERE id = $1',
            [eventId]
        );

        let bonusPoints = 0;
        if (eventResult.rows.length > 0) {
            const realBonusResults = eventResult.rows[0];

            // 3. Compara os palpites com os resultados reais e calcula os pontos
            if (realBonusResults.real_fotn_fight_id && fightOfTheNight == realBonusResults.real_fotn_fight_id) {
                bonusPoints += 20;
            }
            if (realBonusResults.real_potn_fighter_name && performanceOfTheNight === realBonusResults.real_potn_fighter_name) {
                bonusPoints += 20;
            }
        }

        // 4. Atualiza a pontuação do palpite bônus com o valor calculado
        const finalBonusPickResult = await client.query(
            'UPDATE bonus_picks SET points_awarded = $1 WHERE id = $2 RETURNING *',
            [bonusPoints, bonusPickId]
        );

        await client.query('COMMIT');

        res.status(201).json({ message: 'Palpites bônus salvos!', pick: finalBonusPickResult.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao salvar palpites bônus:', error);
        res.status(500).json({ error: 'Erro ao salvar palpites bônus.' });
    } finally {
        client.release();
    }
});
// ROTA PÚBLICA (PARA USUÁRIOS LOGADOS) PARA O RANKING GERAL
app.get('/api/rankings/general', verifyToken, async (req, res) => {
    try {
        // Esta consulta busca o nome de cada usuário e soma todos os pontos
        // que ele já ganhou em todos os eventos.
        const query = `
    WITH CombinedPoints AS (
        -- Pega todos os pontos da tabela de palpites de lutas
        SELECT user_id, points_awarded FROM picks
        UNION ALL
        -- Adiciona todos os pontos da tabela de palpites bônus
        SELECT user_id, points_awarded FROM bonus_picks
    ),
    UserTotals AS (
        -- Soma todos os pontos (de ambas as tabelas) para cada usuário
        SELECT 
            user_id,
            SUM(points_awarded) as total_points
        FROM CombinedPoints
        GROUP BY user_id
    )
    -- Seleciona o nome do usuário e sua pontuação total final
    SELECT
        u.username,
        COALESCE(ut.total_points, 0) as total_points
    FROM users u
    LEFT JOIN UserTotals ut ON u.id = ut.user_id
    WHERE u.is_admin = FALSE -- Continua excluindo admins do ranking público
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
    const { eventId } = req.body;
    const userId = req.user.id;
    try {
        // Busca os dados do evento, incluindo o NOVO campo de preço
        const eventResult = await pool.query('SELECT name, picks_deadline, entry_price FROM events WHERE id = $1', [eventId]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: "Evento não encontrado." });
        const event = eventResult.rows[0];
        const eventName = event.name;

        // 2. Verifica se o prazo para palpites (em UTC) já não expirou
        const deadlineTime = new Date(event.picks_deadline).getTime();
        const now = new Date().getTime();

        if (now > deadlineTime) {
            return res.status(400).json({ error: "O prazo para pagamentos deste evento já encerrou." });
        }

        // 3. Cria a preferência de pagamento
        const preference = new Preference(mpClient);
        const result = await preference.create({
            body: {
                items: [{
                    id: `evt-${eventId}`,
                    title: `Acesso aos Palpites: ${event.name}`,
                    quantity: 1,
                    // USA O PREÇO VINDO DO BANCO DE DADOS!
                    unit_price: parseFloat(event.entry_price),
                    currency_id: 'BRL',
                }],
                back_urls: {
                    success: 'https://mereusguei.github.io/payment-success.html',
                    failure: 'https://mereusguei.github.io/',
                    pending: 'https://mereusguei.github.io/'
                },
                auto_return: 'approved',
                metadata: { user_id: userId, event_id: eventId },
                notification_url: `https://site-palpites-pagos.vercel.app/api/payment-webhook`,
                // Adiciona uma data de expiração para o link de pagamento
                expires: true,
                expiration_date_to: event.picks_deadline // O link expira junto com o prazo do evento
            }
        });

        res.json({ checkoutUrl: result.init_point });
    } catch (error) {
        console.error('Erro ao criar preferência de pagamento:', error);
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

// --- ROTAS DE ADMIN CORRIGIDA ---
app.post('/api/admin/results', verifyToken, verifyAdmin, async (req, res) => {
    // CORREÇÃO: Pega o eventId diretamente do corpo da requisição
    const { eventId, resultsArray, realFightOfTheNightId, realPerformanceOfTheNightFighter } = req.body;
    const dbClient = await pool.connect();

    try {
        await dbClient.query('BEGIN');

        // Apuração de Lutas (só executa se houver lutas para apurar)
        if (resultsArray && resultsArray.length > 0) {
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
                            if (pick.predicted_details === resultDetails) {
                                points += 10;
                            }
                        }
                    }
                    await dbClient.query('UPDATE picks SET points_awarded = $1 WHERE id = $2', [points, pick.id]);
                }
            }
        }

        // Apuração de Bônus (só executa se houver bônus para apurar E se tivermos o eventId)
        if (eventId && realFightOfTheNightId && realPerformanceOfTheNightFighter) {
            await dbClient.query(
                'UPDATE events SET real_fotn_fight_id = $1, real_potn_fighter_name = $2 WHERE id = $3',
                [
                    realFightOfTheNightId === 'NONE' ? null : realFightOfTheNightId,
                    realPerformanceOfTheNightFighter === 'NONE' ? null : realPerformanceOfTheNightFighter,
                    eventId
                ]
            );

            await dbClient.query('UPDATE bonus_picks SET points_awarded = 0 WHERE event_id = $1', [eventId]);
            const bonusPicksResult = await dbClient.query('SELECT * FROM bonus_picks WHERE event_id = $1', [eventId]);

            for (const bonusPick of bonusPicksResult.rows) {
                let bonusPoints = 0;
                if (realFightOfTheNightId !== 'NONE' && bonusPick.fight_of_the_night_fight_id == realFightOfTheNightId) {
                    bonusPoints += 20;
                }
                if (realPerformanceOfTheNightFighter !== 'NONE' && bonusPick.performance_of_the_night_fighter_name === realPerformanceOfTheNightFighter) {
                    bonusPoints += 20;
                }
                await dbClient.query('UPDATE bonus_picks SET points_awarded = $1 WHERE id = $2', [bonusPoints, bonusPick.id]);
            }
        }

        await dbClient.query('COMMIT');
        res.json({ message: `Apuração para o evento ${eventId} concluída com sucesso!` });

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Erro ao apurar resultados:', error);
        res.status(500).json({ error: 'Erro ao apurar resultados.' });
    } finally {
        dbClient.release();
    }
});
// ROTA PARA CRIAR UM NOVO EVENTO
app.post('/api/admin/events', verifyToken, verifyAdmin, async (req, res) => {
    const { name, eventDate, picksDeadline } = req.body;
    if (!name || !eventDate || !picksDeadline) {
        return res.status(400).json({ error: 'Todos os campos do evento são obrigatórios.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO events (name, event_date, picks_deadline) VALUES ($1, $2, $3) RETURNING *',
            [name, eventDate, picksDeadline]
        );
        res.status(201).json({
            message: 'Evento criado com sucesso!',
            event: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao criar evento:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// ROTA PARA ADICIONAR UMA LUTA A UM EVENTO
app.post('/api/admin/fights', verifyToken, verifyAdmin, async (req, res) => {
    const { event_id, fighter1_name, fighter1_record, fighter1_img, fighter2_name, fighter2_record, fighter2_img } = req.body;
    if (!event_id || !fighter1_name || !fighter2_name) {
        return res.status(400).json({ error: 'ID do evento e nome dos lutadores são obrigatórios.' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO fights (event_id, fighter1_name, fighter1_record, fighter1_img, fighter2_name, fighter2_record, fighter2_img) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [event_id, fighter1_name, fighter1_record, fighter1_img, fighter2_name, fighter2_record, fighter2_img]
        );
        res.status(201).json({
            message: 'Luta adicionada com sucesso!',
            fight: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao adicionar luta:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});
// ROTA PARA ATUALIZAR OS DETALHES DE UM EVENTO
app.put('/api/admin/events/:eventId', verifyToken, verifyAdmin, async (req, res) => {
    const { eventId } = req.params;
    const { name, eventDate, picksDeadline, card_image_url } = req.body;
    try {
        const result = await pool.query(
            'UPDATE events SET name = $1, event_date = $2, picks_deadline = $3, card_image_url = $4 WHERE id = $5 RETURNING *',
            [name, eventDate, picksDeadline, card_image_url, eventId] // Garanta que card_image_url está aqui
        );
        res.json({ message: 'Evento atualizado com sucesso!', event: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar evento.' });
    }
});

// ROTA PARA ATUALIZAR OS DETALHES DE UMA LUTA
app.put('/api/admin/fights/:fightId', verifyToken, verifyAdmin, async (req, res) => {
    const { fightId } = req.params;
    const newData = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const oldFightResult = await client.query('SELECT * FROM fights WHERE id = $1', [fightId]);
        if (oldFightResult.rows.length === 0) throw new Error('Luta não encontrada.');
        const oldData = oldFightResult.rows[0];

        // Atualiza a luta com os novos dados
        const updatedFightResult = await client.query(
            `UPDATE fights SET fighter1_name = $1, fighter1_record = $2, fighter1_img = $3, 
             fighter2_name = $4, fighter2_record = $5, fighter2_img = $6 
             WHERE id = $7 RETURNING *`,
            [newData.fighter1_name, newData.fighter1_record, newData.fighter1_img, newData.fighter2_name, newData.fighter2_record, newData.fighter2_img, fightId]
        );
        const updatedFight = updatedFightResult.rows[0];

        const nameChanges = [];
        if (oldData.fighter1_name !== newData.fighter1_name) nameChanges.push({ old: oldData.fighter1_name, new: newData.fighter1_name });
        if (oldData.fighter2_name !== newData.fighter2_name) nameChanges.push({ old: oldData.fighter2_name, new: newData.fighter2_name });

        for (const change of nameChanges) {
            await client.query('UPDATE picks SET predicted_winner_name = $1 WHERE predicted_winner_name = $2', [change.new, change.old]);
            await client.query('UPDATE bonus_picks SET performance_of_the_night_fighter_name = $1 WHERE performance_of_the_night_fighter_name = $2', [change.new, change.old]);
            await client.query('UPDATE events SET real_potn_fighter_name = $1 WHERE real_potn_fighter_name = $2', [change.new, change.old]);
            // CORREÇÃO: Atualiza o winner_name na LUTA ATUALIZADA
            if (updatedFight.winner_name === change.old) {
                updatedFight.winner_name = change.new; // Atualiza o objeto em memória para a reapuração
                await client.query('UPDATE fights SET winner_name = $1 WHERE id = $2', [change.new, fightId]);
            }
        }

        // --- REAPURAÇÃO AUTOMÁTICA E CORRIGIDA ---
        if (updatedFight.winner_name) {
            const picksToRescore = await client.query('SELECT * FROM picks WHERE fight_id = $1', [fightId]);
            for (const pick of picksToRescore.rows) {
                let points = 0;
                // Usa os dados do 'updatedFight' que acabamos de atualizar
                if (pick.predicted_winner_name === updatedFight.winner_name) {
                    points += 20;
                    if (pick.predicted_method === updatedFight.result_method) {
                        points += 15;
                        if (pick.predicted_details === updatedFight.result_details) {
                            points += 10;
                        }
                    }
                }
                await client.query('UPDATE picks SET points_awarded = $1 WHERE id = $2', [points, pick.id]);
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Luta e todos os registros associados atualizados com sucesso!', fight: updatedFight });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar luta:', error);
        res.status(500).json({ error: 'Erro ao atualizar luta.' });
    } finally {
        client.release();
    }
});

// ROTA PARA ATUALIZAR A ORDEM DAS LUTAS
app.put('/api/admin/fights/order', verifyToken, verifyAdmin, async (req, res) => {
    const { fightOrderArray } = req.body; // Espera um array de IDs [3, 1, 2, 4]
    if (!fightOrderArray || !Array.isArray(fightOrderArray)) {
        return res.status(400).json({ error: 'Formato de ordem inválido.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Adiciona uma coluna 'fight_order' se ela não existir
        await client.query(`
            ALTER TABLE fights ADD COLUMN IF NOT EXISTS fight_order INTEGER DEFAULT 0;
        `);
        // Atualiza a ordem de cada luta
        for (let i = 0; i < fightOrderArray.length; i++) {
            const fightId = fightOrderArray[i];
            const order = i + 1; // A ordem é a posição no array
            await client.query('UPDATE fights SET fight_order = $1 WHERE id = $2', [order, fightId]);
        }
        await client.query('COMMIT');
        res.json({ message: 'Ordem das lutas atualizada com sucesso!' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro ao atualizar a ordem das lutas.' });
    } finally {
        client.release();
    }
});
// ROTA DE ADMIN PARA ATUALIZAR O PREÇO DE UM EVENTO
app.put('/api/admin/events/price/:eventId', verifyToken, verifyAdmin, async (req, res) => {
    const { eventId } = req.params;
    const { price } = req.body;
    if (!price || isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'Preço inválido.' });
    }
    try {
        await pool.query('UPDATE events SET entry_price = $1 WHERE id = $2', [price, eventId]);
        res.json({ message: `Preço do evento ${eventId} atualizado para R$ ${price}.` });
    } catch (error) {
        console.error('Erro ao atualizar preço:', error);
        res.status(500).json({ error: 'Erro ao atualizar preço do evento.' });
    }
});
// ROTA PARA REMOVER UMA LUTA ESPECÍFICA
app.delete('/api/admin/fights/:fightId', verifyToken, verifyAdmin, async (req, res) => {
    const { fightId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Apaga os palpites associados a esta luta primeiro
        await client.query('DELETE FROM picks WHERE fight_id = $1', [fightId]);
        // Agora apaga a luta
        await client.query('DELETE FROM fights WHERE id = $1', [fightId]);
        await client.query('COMMIT');
        res.json({ message: `Luta ID ${fightId} e todos os seus palpites foram removidos.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Erro ao remover luta ${fightId}:`, error);
        res.status(500).json({ error: 'Erro ao remover a luta.' });
    } finally {
        client.release();
    }
});

// ROTA PARA REMOVER UM EVENTO INTEIRO (E TUDO ASSOCIADO A ELE)
app.delete('/api/admin/events/:eventId', verifyToken, verifyAdmin, async (req, res) => {
    const { eventId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Apaga em cascata, na ordem de dependência
        await client.query('DELETE FROM bonus_picks WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM picks WHERE fight_id IN (SELECT id FROM fights WHERE event_id = $1)', [eventId]);
        await client.query('DELETE FROM payments WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM fights WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM events WHERE id = $1', [eventId]);
        await client.query('COMMIT');
        res.json({ message: `Evento ID ${eventId} e todos os dados associados (lutas, palpites, pagamentos) foram removidos.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Erro ao remover evento ${eventId}:`, error);
        res.status(500).json({ error: 'Erro ao remover o evento.' });
    } finally {
        client.release();
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
// Rota para buscar a lista de TODOS os eventos, com filtro de status
// Nota: 'verifyToken' pois tanto o admin quanto o usuário logado precisam dela.
app.get('/api/events', verifyToken, async (req, res) => {
    // O filtro virá como um parâmetro na URL, ex: /api/events?status=upcoming
    const { status } = req.query;

    let queryClause = '';
    const now = new Date();

    if (status === 'upcoming') {
        queryClause = 'WHERE event_date >= $1 ORDER BY event_date ASC';
    } else if (status === 'past') {
        queryClause = 'WHERE event_date < $1 ORDER BY event_date DESC';
    } else {
        // Se nenhum status for fornecido, retorna todos (útil para o admin)
        queryClause = 'ORDER BY event_date DESC';
    }

    try {
        // Vamos adicionar uma coluna para a imagem do card do evento
        await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS card_image_url VARCHAR(255);');

        const result = await pool.query(
            // ADICIONE 'picks_deadline' AQUI
            `SELECT id, name, event_date, card_image_url, picks_deadline FROM events ${queryClause}`,
            (status === 'upcoming' || status === 'past') ? [now] : []
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar lista de eventos:', error);
        res.status(500).json({ error: 'Erro ao buscar eventos.' });
    }
});
app.get('/api/admin/events', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM events ORDER BY event_date DESC');
        res.json(result.rows);
    } catch (error) {
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