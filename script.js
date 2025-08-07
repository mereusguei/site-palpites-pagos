// URL da sua API (quando estiver rodando localmente)
const API_URL = 'https://site-palpites-pagos.vercel.app';

// 
document.addEventListener('DOMContentLoaded', () => {
    
    // --- SEÇÃO DE AUTENTICAÇÃO E NAVEGAÇÃO ---
    const userNavigation = document.getElementById('user-navigation');
    const mainContent = document.querySelector('.container');

    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');

    // Esta lógica só roda se estivermos na página principal (index.html)
    if (userNavigation) { 
        if (user && token) {
            // Cenário: Usuário está LOGADO
            userNavigation.innerHTML = `
                <div class="user-profile">
                    <img src="https://i.pravatar.cc/40?u=${user.username}" alt="Foto do Usuário">
                    <span>Olá, ${user.username}</span>
                </div>
                <button id="logout-btn" class="btn btn-logout">Sair</button>
            `;
            
            // Adiciona funcionalidade ao botão de sair
            document.getElementById('logout-btn').addEventListener('click', () => {
                localStorage.removeItem('user');
                localStorage.removeItem('token');
                alert('Você saiu.');
                window.location.reload();
            });

        } else {
            // Cenário: Usuário está DESLOGADO
            userNavigation.innerHTML = `
                <div class="auth-buttons">
                    <a href="login.html" class="btn">Login</a>
                    <a href="register.html" class="btn btn-primary">Cadastro</a>
                </div>
            `;
        }
    }

    // --- SEÇÃO DE PROTEÇÃO DE CONTEÚDO ---
    // Esta lógica só roda se o elemento .container existir na página
    if (mainContent) {
        if (user && token) {
            // Se o container existe E o usuário está logado, busca os dados do evento.
            fetchEventData(1);
        } else {
            // Se o container existe E o usuário NÃO está logado, mostra a mensagem de bloqueio.
            mainContent.innerHTML = `
                <div class="auth-container" style="text-align: center;">
                    <h2>Bem-vindo ao Octagon Oracle!</h2>
                    <p>Por favor, faça login ou cadastre-se para ver os eventos e fazer seus palpites.</p>
                </div>
            `;
        }
    }


    // --- SEÇÃO DE FUNÇÕES GLOBAIS ---
    // Todas as funções que o site precisa para funcionar.

    let eventData = {
        fights: [],
        userPicks: {}
    };

    async function fetchEventData(eventId) {
        try {
            const response = await fetch(`${API_URL}/api/events/${eventId}`);
            if (!response.ok) {
                throw new Error('Não foi possível carregar os dados do evento.');
            }
            const data = await response.json();
            
            eventData.fights = data.fights;
            
            // Atualiza os elementos da página
            const eventHeader = document.querySelector('.event-header h2');
            if(eventHeader) eventHeader.textContent = data.eventName;

            startCountdown(data.picksDeadline);
            populateBonusPicks(data.fights);

            // Carrega os cards de luta na tela
            loadFights();

        } catch (error) {
            console.error(error);
            if (mainContent) {
                 mainContent.innerHTML = `<h2 style="color:red; text-align:center;">${error.message}</h2>`;
            }
        }
    }

    function loadFights() {
        const fightCardGrid = document.getElementById('fight-card-grid');
        if (!fightCardGrid) return; // Não faz nada se o grid não existir na página

        fightCardGrid.innerHTML = '';
        eventData.fights.forEach(fight => {
            const pick = eventData.userPicks[fight.id];
            const fightCard = `
                <div class="fight-card" data-fight-id="${fight.id}">
                    <div class="fighters">
                        <div class="fighter">
                            <img src="${fight.fighter1_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter1_name}">
                            <h4>${fight.fighter1_name}</h4>
                            <span>${fight.fighter1_record || ''}</span>
                        </div>
                        <span class="vs">VS</span>
                        <div class="fighter">
                            <img src="${fight.fighter2_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter2_name}">
                            <h4>${fight.fighter2_name}</h4>
                            <span>${fight.fighter2_record || ''}</span>
                        </div>
                    </div>
                    <div class="pick-status">
                        ${pick ? `<p class="palpite-feito">Palpite: ${pick.winnerName} por ${pick.methodDisplay}</p>` : '<button class="btn btn-pick">Fazer Palpite</button>'}
                    </div>
                </div>
            `;
            fightCardGrid.insertAdjacentHTML('beforeend', fightCard);
        });
        addPickButtonListeners();
    }

    function startCountdown(deadline) {
        const countdownElement = document.getElementById('countdown');
        if(!countdownElement) return; // Não faz nada se o elemento não existir

        const deadlineTime = new Date(deadline).getTime();

        const interval = setInterval(() => {
            const now = new Date().getTime();
            const distance = deadlineTime - now;

            if (distance < 0) {
                clearInterval(interval);
                countdownElement.innerHTML = "PRAZO ENCERRADO";
                document.querySelectorAll('.btn-pick, .btn-save-all').forEach(btn => btn.disabled = true);
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            countdownElement.innerHTML = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        }, 1000);
    }

    function populateBonusPicks(fights) {
        const fightSelect = document.getElementById('fight-of-night');
        const perfSelect = document.getElementById('performance-of-night');
        if(!fightSelect || !perfSelect) return; // Não faz nada se não estiver na página certa

        fightSelect.innerHTML = '<option value="">Selecione a luta...</option>';
        perfSelect.innerHTML = '<option value="">Selecione o lutador...</option>';

        const allFighters = new Set();

        fights.forEach(fight => {
            const fightOption = document.createElement('option');
            fightOption.value = fight.id;
            fightOption.textContent = `${fight.fighter1_name} vs ${fight.fighter2_name}`;
            fightSelect.appendChild(fightOption);

            allFighters.add(fight.fighter1_name);
            allFighters.add(fight.fighter2_name);
        });

        allFighters.forEach(fighterName => {
            const perfOption = document.createElement('option');
            perfOption.value = fighterName;
            perfOption.textContent = fighterName;
            perfSelect.appendChild(perfOption);
        });
    }

    function addPickButtonListeners() {
    // Adiciona o "ouvinte" a cada botão "Fazer Palpite"
    document.querySelectorAll('.btn-pick').forEach(button => {
        button.addEventListener('click', (e) => {
            // Pega o ID da luta do card onde o botão foi clicado
            const fightId = parseInt(e.target.closest('.fight-card').dataset.fightId);
            openPickModal(fightId);
        });
    });
}

function openPickModal(fightId) {
    // Seleciona os elementos do modal
    const modal = document.getElementById('pick-modal');
    const pickForm = document.getElementById('pick-form');
    const modalTitle = document.getElementById('modal-title');
    const fighter1Div = document.getElementById('modal-fighter1');
    const fighter2Div = document.getElementById('modal-fighter2');
    const methodGroup = document.getElementById('method-group');
    const roundGroup = document.getElementById('round-group');
    const decisionTypeGroup = document.getElementById('decision-type-group');

    // Encontra os dados da luta específica no nosso objeto eventData
    const fight = eventData.fights.find(f => f.id === fightId);
    if (!fight) {
        console.error('Luta não encontrada!');
        return;
    }

    // --- PREPARA O MODAL PARA SER EXIBIDO ---
    
    // 1. Reseta o formulário e esconde os campos condicionais
    pickForm.reset();
    methodGroup.style.display = 'none';
    roundGroup.style.display = 'none';
    decisionTypeGroup.style.display = 'none';
    document.querySelectorAll('.fighter-option, .method-btn').forEach(el => el.classList.remove('selected'));

    // 2. Preenche os dados da luta
    document.getElementById('fight-id').value = fight.id;
    modalTitle.textContent = `Palpite para: ${fight.fighter1_name} vs ${fight.fighter2_name}`;
    
    // Lutador 1
    fighter1Div.innerHTML = `<img src="${fight.fighter1_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter1_name}"><h4>${fight.fighter1_name}</h4>`;
    fighter1Div.dataset.fighterName = fight.fighter1_name;

    // Lutador 2
    fighter2Div.innerHTML = `<img src="${fight.fighter2_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter2_name}"><h4>${fight.fighter2_name}</h4>`;
    fighter2Div.dataset.fighterName = fight.fighter2_name;

    // 3. Torna o modal visível
    if (modal) {
        modal.classList.add('active');
    }
}

// =================== APAGUE TUDO DAQUI PARA CIMA E COLE ESTE BLOCO ===================

// --- ADICIONA A LÓGICA DE INTERAÇÃO DO MODAL ---
// Esta seção só deve existir UMA VEZ no seu código.

// Pega referências aos elementos do modal UMA VEZ
const modal = document.getElementById('pick-modal');
const pickForm = document.getElementById('pick-form');

// Só adiciona os 'listeners' se o modal realmente existir na página
if (modal) {
    // Lógica para fechar o modal
    const closeModalBtn = modal.querySelector('.close-modal');
    closeModalBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    // Lógica para selecionar o vencedor (Camada 1)
    document.querySelectorAll('.fighter-option').forEach(div => {
        div.addEventListener('click', () => {
            document.querySelectorAll('.fighter-option').forEach(d => d.classList.remove('selected'));
            div.classList.add('selected');
            document.getElementById('winner').value = div.dataset.fighterName;
            document.getElementById('method-group').style.display = 'block'; // Mostra a próxima camada
        });
    });

    // Lógica para selecionar o método (Camada 2)
    document.querySelectorAll('.method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const method = btn.dataset.method;

            // Mostra o grupo correto da Camada 3
            if (method === 'Decision') {
                document.getElementById('decision-type-group').style.display = 'block';
                document.getElementById('round-group').style.display = 'none';
            } else { // KO/TKO ou Submission
                document.getElementById('decision-type-group').style.display = 'none';
                document.getElementById('round-group').style.display = 'block';
            }
        });
    });
}

// Lógica para o formulário ao ser enviado (ÚNICA E CORRETA)
if (pickForm) {
    pickForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const fightId = parseInt(document.getElementById('fight-id').value);
        const winnerName = document.getElementById('winner').value;
        const methodBtn = document.querySelector('.method-btn.selected');
        
        if (!winnerName || !methodBtn) {
            return alert('Por favor, selecione o vencedor e o método da vitória.');
        }

        const method = methodBtn.dataset.method;
        let details = '';
        let methodDisplay = '';

        if (method === 'Decision') {
            const decisionType = pickForm.querySelector('[name="decision-type"]').value;
            details = decisionType;
            methodDisplay = `Decisão ${decisionType}`;
        } else {
            const round = pickForm.querySelector('[name="round"]').value;
            details = `Round ${round}`;
            methodDisplay = `${method} no ${details}`;
        }

        // Pega o token do localStorage
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Você precisa estar logado para salvar um palpite.');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/picks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` // Envia o token no cabeçalho
                },
                body: JSON.stringify({
                    fightId,
                    winnerName,
                    method,
                    details
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Não foi possível salvar o palpite.');
            }

            alert('Palpite salvo com sucesso!');
            
            // Atualiza o objeto de palpites localmente para refletir na tela
            eventData.userPicks[fightId] = { winnerName, methodDisplay };
            loadFights(); // Recarrega os cards para mostrar o palpite salvo

            if(modal) modal.classList.remove('active');

        } catch (error) {
            console.error('Erro:', error);
            alert(`Erro ao salvar palpite: ${error.message}`);
        }
    });
}