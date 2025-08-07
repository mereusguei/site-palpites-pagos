document.addEventListener('DOMContentLoaded', () => {

    // URL da sua API (quando estiver rodando localmente)
const API_URL = 'https://site-palpites-pagos.vercel.app';

// Armazenará os dados vindos da API
let eventData = {
    fights: [],
    userPicks: {}
};

// Função para buscar os dados do evento da nossa API
async function fetchEventData(eventId) {
    try {
        const response = await fetch(`${API_URL}/api/events/${eventId}`);
        if (!response.ok) {
            throw new Error('Não foi possível carregar os dados do evento.');
        }
        const data = await response.json();
        
        // Atualiza os dados do evento
        eventData.fights = data.fights;

        // Atualiza o timer!
        startCountdown(data.picksDeadline);

        // Popula os dropdowns de bônus!
        populateBonusPicks(data.fights);

        // Carrega os cards de luta na tela
        loadFights();

    } catch (error) {
        console.error(error);
        document.querySelector('.container').innerHTML = `<h2 style="color:red; text-align:center;">${error.message}</h2>`;
    }
}

// Função para o Countdown Real
function startCountdown(deadline) {
    const countdownElement = document.getElementById('countdown');
    const deadlineTime = new Date(deadline).getTime();

    const interval = setInterval(() => {
        const now = new Date().getTime();
        const distance = deadlineTime - now;

        if (distance < 0) {
            clearInterval(interval);
            countdownElement.innerHTML = "PRAZO ENCERRADO";
            // AQUI VOCÊ DEVE DESABILITAR TODOS OS BOTÕES DE PALPITE
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

// Função para popular os dropdowns de bônus
function populateBonusPicks(fights) {
    const fightSelect = document.getElementById('fight-of-night');
    const perfSelect = document.getElementById('performance-of-night');

    fightSelect.innerHTML = '<option value="">Selecione a luta...</option>';
    perfSelect.innerHTML = '<option value="">Selecione o lutador...</option>';

    const allFighters = new Set(); // Usamos Set para evitar nomes duplicados

    fights.forEach(fight => {
        // Adiciona a luta ao dropdown de "Luta da Noite"
        const fightOption = document.createElement('option');
        fightOption.value = fight.id;
        fightOption.textContent = `${fight.fighter1_name} vs ${fight.fighter2_name}`;
        fightSelect.appendChild(fightOption);

        // Adiciona os lutadores ao Set
        allFighters.add(fight.fighter1_name);
        allFighters.add(fight.fighter2_name);
    });

    // Adiciona cada lutador ao dropdown de "Performance da Noite"
    allFighters.forEach(fighterName => {
        const perfOption = document.createElement('option');
        perfOption.value = fighterName;
        perfOption.textContent = fighterName;
        perfSelect.appendChild(perfOption);
    });
}

    const fightCardGrid = document.getElementById('fight-card-grid');
    const modal = document.getElementById('pick-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const pickForm = document.getElementById('pick-form');
    
    // Carregar lutas na página
    function loadFights() {
        fightCardGrid.innerHTML = '';
        eventData.fights.forEach(fight => {
            const pick = eventData.userPicks[fight.id];
            const fightCard = `
                <div class="fight-card" data-fight-id="${fight.id}">
                    <div class="fighters">
                        <div class="fighter">
                            <img src="${fight.img1}" alt="${fight.fighter1}">
                            <h4>${fight.fighter1}</h4>
                            <span>${fight.record1}</span>
                        </div>
                        <span class="vs">VS</span>
                        <div class="fighter">
                            <img src="${fight.img2}" alt="${fight.fighter2}">
                            <h4>${fight.fighter2}</h4>
                            <span>${fight.record2}</span>
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
    
    // Abrir modal de palpite
    function openPickModal(fightId) {
        const fight = eventData.fights.find(f => f.id === fightId);
        if (!fight) return;

        // Resetar formulário
        pickForm.reset();
        document.getElementById('method-group').style.display = 'none';
        document.getElementById('round-group').style.display = 'none';
        document.getElementById('decision-type-group').style.display = 'none';
        document.querySelectorAll('.fighter-option, .method-btn').forEach(el => el.classList.remove('selected'));

        document.getElementById('fight-id').value = fight.id;
        document.getElementById('modal-title').textContent = `Palpite para: ${fight.fighter1} vs ${fight.fighter2}`;
        
        const fighter1Div = document.getElementById('modal-fighter1');
        fighter1Div.innerHTML = `<img src="${fight.img1}" alt="${fight.fighter1}"><h4>${fight.fighter1}</h4>`;
        fighter1Div.dataset.fighterName = fight.fighter1;

        const fighter2Div = document.getElementById('modal-fighter2');
        fighter2Div.innerHTML = `<img src="${fight.img2}" alt="${fight.fighter2}"><h4>${fight.fighter2}</h4>`;
        fighter2Div.dataset.fighterName = fight.fighter2;

        modal.classList.add('active');
    }

    // Lógica do formulário do modal
    document.querySelectorAll('.fighter-option').forEach(div => {
        div.addEventListener('click', () => {
            document.querySelectorAll('.fighter-option').forEach(d => d.classList.remove('selected'));
            div.classList.add('selected');
            document.getElementById('winner').value = div.dataset.fighterName;
            document.getElementById('method-group').style.display = 'block';
        });
    });

    document.querySelectorAll('.method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const method = btn.dataset.method;
            if (method === 'Decision') {
                document.getElementById('decision-type-group').style.display = 'block';
                document.getElementById('round-group').style.display = 'none';
            } else {
                document.getElementById('decision-type-group').style.display = 'none';
                document.getElementById('round-group').style.display = 'block';
            }
        });
    });

    // Salvar palpite
    pickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fightId = parseInt(document.getElementById('fight-id').value);
        const winnerName = document.getElementById('winner').value;
        const methodBtn = document.querySelector('.method-btn.selected');
        
        if (!winnerName || !methodBtn) {
            alert('Por favor, selecione o vencedor e o método da vitória.');
            return;
        }

        const method = methodBtn.dataset.method;
        let details = '';
        let methodDisplay = method;

        if (method === 'Decision') {
            const decisionType = pickForm.querySelector('[name="decision-type"]').value;
            details = decisionType;
            methodDisplay = `Decisão ${decisionType}`;
        } else {
            const round = pickForm.querySelector('[name="round"]').value;
            details = `Round ${round}`;
            methodDisplay = `${method} no ${details}`;
        }

        eventData.userPicks[fightId] = {
            winnerName,
            method,
            details,
            methodDisplay
        };

        console.log('Palpite salvo:', eventData.userPicks[fightId]);
        modal.classList.remove('active');
        loadFights(); // Recarrega os cards para mostrar o palpite feito
    });

    // Fechar modal
    closeModalBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    // Adicionar listeners aos botões "Fazer Palpite"
    function addPickButtonListeners() {
        document.querySelectorAll('.btn-pick').forEach(button => {
            button.addEventListener('click', (e) => {
                const fightId = parseInt(e.target.closest('.fight-card').dataset.fightId);
                openPickModal(fightId);
            });
        });
    }

    // Iniciar
    fetchEventData(1);
});