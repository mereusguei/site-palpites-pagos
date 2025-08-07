// A URL do seu backend na Vercel
const API_URL = 'https://site-palpites-pagos.vercel.app';

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const errorMessageDiv = document.getElementById('error-message');

// Lógica para o formulário de Cadastro
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessageDiv.textContent = ''; // Limpa mensagens de erro antigas

        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Algo deu errado');
            }

            alert('Cadastro realizado com sucesso! Você já pode fazer login.');
            window.location.href = 'login.html'; // Redireciona para a página de login

        } catch (error) {
            errorMessageDiv.textContent = error.message;
        }
    });
}

// Lógica para o formulário de Login
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessageDiv.textContent = '';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Algo deu errado');
            }
            
            // Login bem-sucedido! Salva o token e dados do usuário no navegador
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            alert('Login bem-sucedido!');
            window.location.href = 'index.html'; // Redireciona para a página principal

        } catch (error) {
            errorMessageDiv.textContent = error.message;
        }
    });
}