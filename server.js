// Importa os pacotes que instalamos
require('dotenv').config(); // Carrega as variáveis do arquivo .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Importa o driver do PostgreSQL

// Cria a instância do nosso servidor Express
const app = express();
const PORT = process.env.PORT || 3000; // O Render.com vai nos dar uma porta, se não, usamos a 3000

// Configura a conexão com o banco de dados Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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


// Inicia o servidor para ele ficar "ouvindo" por requisições
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});