// =================== CÓDIGO COMPLETO E CORRIGIDO PARA script.js ===================

// URL da sua API pública na Vercel
const API_URL = 'https://site-palpites-pagos.vercel.app';

// Bloco principal que garante que o código só rode após a página carregar
document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. LÓGICA DE AUTENTICAÇÃO E NAVEGAÇÃO ---
    const userNavigation = document.getElementById('user-navigation');
    const mainContent = document.querySelector('.container');
    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');

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

    // --- 2. LÓGICA DE PROTEÇÃO DE CONTEÚDO E CARREGAMENTO DE DADOS ---
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

    // --- 3. SEÇÃO DE FUNÇÕES GLOBAIS ---
    let eventData = { fights: [], userPicks: {} };

    async function fetchEventData(eventId) {
        try {
            const response = await fetch(`${API_URL}/api/events/${eventId}`);
            if (!response.ok) throw new Error('Não foi possível carregar os dados do evento.');
            const data = await response.json();
            
            eventData.fights = data.fights;
            
            const eventHeader = document.querySelector('.event-header h2');
            if(eventHeader) eventHeader.textContent = data.eventName;

            startCountdown(data.picksDeadline);
            populateBonusPicks(data.fights);
            loadFights();
        } catch (error) {
            console.error(error);
            if (mainContent) mainContent.innerHTML = `<h2 style="color:red; text-align:center;">${error.message}</h2>`;
        }
    }

    function loadFights() {
        const fightCardGrid = document.getElementById('fight-card-grid');
        if (!fightCardGrid) return;

        fightCardGrid.innerHTML = '';
        eventData.fights.forEach(fight => {
            const pick = eventData.userPicks[fight.id];
            fightCardGrid.innerHTML += `
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
                </div>`;
        });
        addPickButtonListeners();
    }

    function addPickButtonListeners() {
        document.querySelectorAll('.btn-pick').forEach(button => {
            button.addEventListener('click', e => {
                const fightId = parseInt(e.target.closest('.fight-card').dataset.fightId);
                openPickModal(fightId);
            });
        });
    }

    function openPickModal(fightId) {
        const modal = document.getElementById('pick-modal');
        const fight = eventData.fights.find(f => f.id === fightId);
        if (!modal || !fight) return;

        modal.querySelector('#pick-form').reset();
        ['method-group', 'round-group', 'decision-type-group'].forEach(id => modal.querySelector(`#${id}`).style.display = 'none');
        modal.querySelectorAll('.fighter-option, .method-btn').forEach(el => el.classList.remove('selected'));

        modal.querySelector('#fight-id').value = fight.id;
        modal.querySelector('#modal-title').textContent = `Palpite para: ${fight.fighter1_name} vs ${fight.fighter2_name}`;
        
        const fighter1Div = modal.querySelector('#modal-fighter1');
        fighter1Div.innerHTML = `<img src="${fight.fighter1_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter1_name}"><h4>${fight.fighter1_name}</h4>`;
        fighter1Div.dataset.fighterName = fight.fighter1_name;

        const fighter2Div = modal.querySelector('#modal-fighter2');
        fighter2Div.innerHTML = `<img src="${fight.fighter2_img || 'https://via.placeholder.com/80'}" alt="${fight.fighter2_name}"><h4>${fight.fighter2_name}</h4>`;
        fighter2Div.dataset.fighterName = fight.fighter2_name;
        
        modal.classList.add('active');
    }

    function startCountdown(deadline) { /* ...código da função... */ }
    function populateBonusPicks(fights) { /* ...código da função... */ }


    // --- 4. LÓGICA DE INTERAÇÃO DO MODAL (ÚNICA E CENTRALIZADA) ---
    const modal = document.getElementById('pick-modal');
    if (modal) {
        // Lógica para fechar o modal
        modal.querySelector('.close-modal').addEventListener('click', () => modal.classList.remove('active'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

        // Lógica para selecionar o vencedor (Camada 1)
        modal.querySelectorAll('.fighter-option').forEach(div => {
            div.addEventListener('click', () => {
                modal.querySelectorAll('.fighter-option').forEach(d => d.classList.remove('selected'));
                div.classList.add('selected');
                modal.querySelector('#winner').value = div.dataset.fighterName;
                modal.querySelector('#method-group').style.display = 'block';
            });
        });

        // Lógica para selecionar o método (Camada 2)
        modal.querySelectorAll('.method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                const method = btn.dataset.method;
                modal.querySelector('#decision-type-group').style.display = method === 'Decision' ? 'block' : 'none';
                modal.querySelector('#round-group').style.display = method !== 'Decision' ? 'block' : 'none';
            });
        });

        // Lógica para o formulário ao ser ENVIADO (Onde a mágica acontece)
        modal.querySelector('#pick-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const fightId = parseInt(modal.querySelector('#fight-id').value);
            const winnerName = modal.querySelector('#winner').value;
            const methodBtn = modal.querySelector('.method-btn.selected');
            
            if (!winnerName || !methodBtn) return alert('Por favor, selecione o vencedor e o método da vitória.');

            const method = methodBtn.dataset.method;
            let details = '';
            let methodDisplay = '';

            if (method === 'Decision') {
                details = modal.querySelector('[name="decision-type"]').value;
                methodDisplay = `Decisão ${details}`;
            } else {
                details = `Round ${modal.querySelector('[name="round"]').value}`;
                methodDisplay = `${method} no ${details}`;
            }

            const token = localStorage.getItem('token');
            if (!token) return alert('Você precisa estar logado para salvar um palpite.');

            try {
                const response = await fetch(`${API_URL}/api/picks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ fightId, winnerName, method, details }),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o palpite.');

                alert('Palpite salvo com sucesso!');
                
                eventData.userPicks[fightId] = { winnerName, methodDisplay };
                loadFights();
                modal.classList.remove('active');

            } catch (error) {
                console.error('Erro:', error);
                alert(`Erro ao salvar palpite: ${error.message}`);
            }
        });
    }

}); // Fim do 'DOMContentLoaded'