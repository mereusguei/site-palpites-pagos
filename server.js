// Importa os pacotes que instalamos
require('dotenv').config(); // Carrega as variáveis do arquivo .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Importa o driver do PostgreSQL

// No topo do server.js
const { MercadoPagoConfig, Preference } = require('mercadopago');
// Abaixo das importações
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Cria a instância do nosso servidor Express
const app = express();
const PORT = process.env.PORT || 3000; // O Render.com vai nos dar uma porta, se não, usamos a 3000

// Configura a conexão com o banco de dados Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Middlewares (configurações do servidor)
app.use(cors()); // Permite requisições de outros domínios
app.use(express.json()); // Permite que o servidor entenda JSON no corpo das requisições

//
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Adicione uma chave secreta para o JWT. No mundo real, isso viria de uma variável de ambiente.
const JWT_SECRET = 'sua-chave-secreta-super-dificil-de-adivinhar-123';

// MIDDLEWARE PARA VERIFICAR O TOKEN
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato "Bearer TOKEN"

    if (!token) {
        return res.sendStatus(401); // Unauthorized (Não autorizado)
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.sendStatus(403); // Forbidden (Token inválido/expirado)
        }
        req.user = user; // Adiciona os dados do usuário (id, username) à requisição
        next(); // Passa para a próxima função (a rota real)
    });
};

// MIDDLEWARE PARA VERIFICAR SE O USUÁRIO É ADMIN
const verifyAdmin = async (req, res, next) => {
    const userId = req.user.id; // Isso vem do middleware verifyToken

    try {
        const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
        
        // Se o usuário não for encontrado ou não for admin
        if (userResult.rows.length === 0 || !userResult.rows[0].is_admin) {
            return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
        }

        next(); // Se for admin, permite que a requisição continue
    } catch (error) {
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

// ROTA DE CADASTRO (REGISTER)
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
    }

    try {
        // Criptografa a senha antes de salvar
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Insere o novo usuário no banco de dados
        const newUserResult = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
            [username, email, password_hash]
        );

        res.status(201).json({
            message: 'Usuário cadastrado com sucesso!',
            user: newUserResult.rows[0]
        });

    } catch (error) {
        console.error('Erro no cadastro:', error);
        // Verifica se o erro é de violação de chave única (usuário/email já existe)
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Nome de usuário ou e-mail já cadastrado.' });
        }
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// ROTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
    }

    try {
        // Procura o usuário pelo email
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
        const user = userResult.rows[0];

        // Compara a senha enviada com a senha criptografada no banco
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        // Se a senha estiver correta, cria um token de autenticação (JWT)
        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '1d' } // Token expira em 1 dia
        );

        res.json({
            message: 'Login bem-sucedido!',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});
// === NOSSAS ROTAS DA API VÊM AQUI ===

// Rota de teste para ver se o servidor está funcionando
app.get('/', (req, res) => {
    res.send('<h1>API do Octagon Oracle está no ar!</h1>');
});

// Rota para buscar os dados de um evento (ex: evento com id=1)
// Isso resolve o problema do seu timer e dos dropdowns dinâmicos
// Rota para buscar os dados de um evento E OS PALPITES DO USUÁRIO LOGADO
app.get('/api/events/:id', verifyToken, async (req, res) => {
    const { id: eventId } = req.params;
    const userId = req.user.id; // Pegamos o ID do usuário logado do token

    try {
        // Busca dados do evento
        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'Evento não encontrado.' });
        }
        const event = eventResult.rows[0];

        // Busca as lutas do evento
        const fightsResult = await pool.query('SELECT * FROM fights WHERE event_id = $1 ORDER BY id', [eventId]);
        const fights = fightsResult.rows;

        // NOVA PARTE: Busca os palpites que este usuário já fez para este evento
        const picksResult = await pool.query('SELECT * FROM picks WHERE user_id = $1 AND fight_id IN (SELECT id FROM fights WHERE event_id = $2)', [userId, eventId]);
        
        // Transforma o array de palpites em um objeto para fácil acesso no frontend: { fightId: pickData }
        const userPicks = picksResult.rows.reduce((acc, pick) => {
            acc[pick.fight_id] = pick;
            return acc;
        }, {});

        // Combina tudo na resposta
        const responseData = {
            eventName: event.name,
            picksDeadline: event.picks_deadline,
            fights: fights,
            userPicks: userPicks // Envia os palpites do usuário!
        };

        res.json(responseData);

    } catch (error) {
        console.error('Erro ao buscar dados do evento:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// ROTA PARA SALVAR/ATUALIZAR UM PALPITE
// Usamos o middleware verifyToken para proteger esta rota
app.post('/api/picks', verifyToken, async (req, res) => {
    const userId = req.user.id; // Pegamos o ID do usuário do token verificado
    const { fightId, winnerName, method, details } = req.body;

    if (!fightId || !winnerName || !method || !details) {
        return res.status(400).json({ error: 'Dados do palpite incompletos.' });
    }

    try {
        // A mágica do "UPSERT": INSERT... ON CONFLICT... UPDATE
        // Isso tenta INSERIR. Se já existir um palpite para esse user/fight (CONFLITO), ele ATUALIZA.
        const query = `
            INSERT INTO picks (user_id, fight_id, predicted_winner_name, predicted_method, predicted_details)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, fight_id) 
            DO UPDATE SET
                predicted_winner_name = EXCLUDED.predicted_winner_name,
                predicted_method = EXCLUDED.predicted_method,
                predicted_details = EXCLUDED.predicted_details
            RETURNING *;
        `;

        const values = [userId, fightId, winnerName, method, details];
        const result = await pool.query(query, values);

        res.status(201).json({ 
            message: 'Palpite salvo com sucesso!', 
            pick: result.rows[0] 
        });

    } catch (error) {
        console.error('Erro ao salvar o palpite:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao salvar o palpite.' });
    }
});


// Rota para um usuário salvar seus palpites
// ESSA ROTA AGORA DEVE SER PROTEGIDA E SÓ FUNCIONAR SE O USUÁRIO PAGOU
app.post('/api/picks', async (req, res) => {
    // AQUI VAI A LÓGICA:
    // 1. Pegar o ID do usuário (do token de autenticação, que é um passo mais avançado)
    // 2. Pegar os palpites do corpo da requisição (req.body)
    // 3. VERIFICAR na tabela `payments` se esse usuário pagou por este evento.
    // 4. Se pagou, usar um loop para inserir ou atualizar os palpites na tabela `picks`.
    // 5. Se não pagou, retornar um erro 403 (Forbidden).
    
    // Simulação:
    const { userId, eventId, picks } = req.body;
    console.log(`Recebido pedido para salvar palpites do usuário ${userId} para o evento ${eventId}`);
    // ... aqui viria a lógica real ...
    res.status(201).json({ message: 'Palpites salvos com sucesso!'});
});

// ROTA PARA VERIFICAR O STATUS DE PAGAMENTO DE UM USUÁRIO PARA UM EVENTO
app.get('/api/payment-status/:eventId', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { eventId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM payments WHERE user_id = $1 AND event_id = $2 AND status = $3',
            [userId, eventId, 'PAID']
        );

        res.json({ hasPaid: result.rows.length > 0 });

    } catch (error) {
        console.error('Erro ao verificar status de pagamento:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// ROTA PARA CRIAR UMA PREFERÊNCIA DE PAGAMENTO
app.post('/api/create-payment', verifyToken, async (req, res) => {
    const { eventId, eventName } = req.body;
    const userId = req.user.id;

    try {
        const preference = new Preference(client);

        const result = await preference.create({
            body: {
                items: [
                    {
                        id: `evt-${eventId}`,
                        title: `Acesso aos Palpites: ${eventName}`,
                        quantity: 1,
                        unit_price: 0.05, // Preço do acesso em R$
                        currency_id: 'BRL',
                    }
                ],
                back_urls: {
                    // URLs para onde o usuário será redirecionado após o pagamento
                    success: 'https://mereusguei.github.io/payment-success.html', // Criaremos esta página
                    failure: 'https://mereusguei.github.io/', // Volta para a home em caso de falha
                    pending: 'https://mereusguei.github.io/', // Volta para a home se estiver pendente
                },
                auto_return: 'approved', // Retorna automaticamente em caso de sucesso
                metadata: { // Dados extras que queremos associar ao pagamento
                    user_id: userId,
                    event_id: eventId
                },
                notification_url: `https://site-palpites-pagos.vercel.app/api/payment-webhook` // Onde o MP vai nos avisar
            }
        });

        // Envia o link de checkout de volta para o frontend
        res.json({ checkoutUrl: result.init_point });

    } catch (error) {
        console.error('Erro ao criar preferência de pagamento:', error);
        res.status(500).json({ error: 'Não foi possível iniciar o pagamento.' });
    }
});


// ROTA PARA RECEBER NOTIFICAÇÕES (WEBHOOK) DO MERCADO PAGO
app.post('/api/payment-webhook', async (req, res) => {
    const notification = req.body;

    console.log('Webhook recebido:', notification);

    try {
        if (notification.type === 'payment') {
            const paymentId = notification.data.id;

            // Busca os detalhes completos do pagamento na API do Mercado Pago
            const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
            });
            const paymentDetails = await paymentResponse.json();
            
            console.log('Detalhes do pagamento:', paymentDetails.status, paymentDetails.metadata);

            // Se o pagamento foi aprovado e tem nosso metadata
            if (paymentDetails.status === 'approved' && paymentDetails.metadata) {
                const { user_id, event_id } = paymentDetails.metadata;

                // Salva o registro na nossa tabela `payments`
                await pool.query(
                    'INSERT INTO payments (user_id, event_id, status) VALUES ($1, $2, $3)',
                    [user_id, event_id, 'PAID']
                );
                console.log(`Pagamento para user ${user_id} e evento ${event_id} salvo com sucesso!`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Erro no webhook:', error);
        res.sendStatus(500);
    }
});

// ROTA DE ADMIN PARA SUBMETER OS RESULTADOS DE UMA LUTA
// Protegida por verifyToken e verifyAdmin em sequência
app.post('/api/admin/results', verifyToken, verifyAdmin, async (req, res) => {
    const { fightId, winnerName, resultMethod, resultDetails } = req.body;

    if (!fightId || !winnerName || !resultMethod || !resultDetails) {
        return res.status(400).json({ error: 'Dados do resultado incompletos.' });
    }

    const client = await pool.connect(); // Inicia uma transação para garantir a integridade dos dados

    try {
    await client.query('BEGIN');

    // ANTES de calcular, vamos ZERAR os pontos para esta luta.
    // Isso garante que não estamos somando pontos de apurações antigas.
    await client.query('UPDATE picks SET points_awarded = 0 WHERE fight_id = $1', [fightId]);

    // 1. Atualiza o resultado real na tabela de lutas (como antes)
    await client.query(
        'UPDATE fights SET winner_name = $1, result_method = $2, result_details = $3 WHERE id = $4',
        [winnerName, resultMethod, resultDetails, fightId]
    );

        // 2. Busca todos os palpites para esta luta
        const picksResult = await client.query('SELECT * FROM picks WHERE fight_id = $1', [fightId]);
        const picks = picksResult.rows;

        // 3. Itera sobre cada palpite para calcular os pontos
        for (const pick of picks) {
            let points = 0;
            // Regra 1: Acertou o vencedor?
            if (pick.predicted_winner_name === winnerName) {
                points += 20; // Ganha 20 pontos
                
                // Regra 2: Se acertou o vencedor, acertou o método?
                if (pick.predicted_method === resultMethod) {
                    points += 15; // Ganha 15 pontos extras
                    
                    // Regra 3: Se acertou o método, acertou o detalhe?
                    if (pick.predicted_details === resultDetails) {
                        points += 10; // Ganha 10 pontos extras (acerto perfeito!)
                    }
                }
            }
            
            // 4. Atualiza a pontuação daquele palpite específico no banco
            await client.query('UPDATE picks SET points_awarded = $1 WHERE id = $2', [points, pick.id]);
        }
        
        await client.query('COMMIT'); // Finaliza a transação com sucesso

        res.json({ message: `Resultados da luta ${fightId} apurados e ${picks.length} palpites pontuados.` });

    } catch (error) {
        await client.query('ROLLBACK'); // Desfaz tudo se der algum erro no meio do caminho
        console.error('Erro ao apurar resultados:', error);
        res.status(500).json({ error: 'Erro ao apurar resultados.' });
    } finally {
        client.release(); // Libera a conexão com o banco
    }
});

// ROTA DE ADMIN PARA VER TODOS OS PALPITES, AGRUPADOS POR EVENTO E USUÁRIO
app.get('/api/admin/all-picks', verifyToken, verifyAdmin, async (req, res) => {
    try {
        // 1. Busca todos os eventos, palpites e usuários de uma vez
        const query = `
            SELECT 
                e.id as event_id, e.name as event_name,
                u.id as user_id, u.username,
                p.id as pick_id, p.fight_id, p.predicted_winner_name, 
                p.predicted_method, p.predicted_details, p.points_awarded,
                f.winner_name as real_winner, f.result_method as real_method, f.result_details as real_details
            FROM events e
            JOIN fights f ON e.id = f.event_id
            JOIN picks p ON f.id = p.fight_id
            JOIN users u ON p.user_id = u.id
            ORDER BY e.id, u.username, p.fight_id;
        `;
        const allData = await pool.query(query);

        // 2. Processa e agrupa os dados
const results = {};
for (const row of allData.rows) {
    if (!results[row.event_id]) {
        results[row.event_id] = { eventName: row.event_name, users: {} };
    }
    if (!results[row.event_id].users[row.user_id]) {
        results[row.event_id].users[row.user_id] = {
            username: row.username,
            picks: [],
            stats: {
                totalPicks: 0, correctWinners: 0,
                correctMethods: 0, correctDetails: 0,
                totalPoints: 0
            }
        };
    }

    const userEventData = results[row.event_id].users[row.user_id];
    userEventData.picks.push(row);

    // Calcula as estatísticas
    const stats = userEventData.stats;
    stats.totalPicks++;
    stats.totalPoints += row.points_awarded;
    if (row.real_winner) { // Só calcula acertos se a luta foi apurada
        // A LÓGICA DE CÁLCULO DE ACERTOS EM CASCATA
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
res.json(results);
    } catch (error) {
        console.error('Erro ao buscar todos os palpites:', error);
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});


// Inicia o servidor e testa a conexão com o banco
app.listen(PORT, async () => {
    try {
        await pool.query('SELECT NOW()'); // Tenta executar uma consulta simples
        console.log(`Servidor rodando na porta ${PORT} e conectado ao banco de dados com sucesso.`);
    } catch (error) {
        console.error('*** FALHA AO CONECTAR AO BANCO DE DADOS ***');
        console.error(error);
    }
});