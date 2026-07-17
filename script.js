// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE
// ==========================================
const supabaseUrl = 'https://wgqqbahoalozgfukioza.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndncXFiYWhvYWxvemdmdWtpb3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNTA3OTYsImV4cCI6MjA5OTgyNjc5Nn0.v_kpYceS8ceIUBNaLLHjfyBeFA2Y3lDRy7Yn6cb5Uz8';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;

// Tablas de multiplicadores reales basadas en Stake
const MULTIPLIERS = {
    8: {
        Low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        Medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        High: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]
    },
    12: {
        Low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        Medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        High: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170]
    },
    16: {
        Low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
        Medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
        High: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]
    }
};

// Generar tablas intermedias secuencialmente
for (let r = 8; r <= 16; r++) {
    if (!MULTIPLIERS[r]) {
        MULTIPLIERS[r] = { Low: [], Medium: [], High: [] };
        ['Low', 'Medium', 'High'].forEach(risk => {
            let base = MULTIPLIERS[r - 1][risk];
            let newArr = [...base];
            let midIndex = Math.floor(newArr.length / 2);
            newArr.splice(midIndex, 0, newArr[midIndex]);
            MULTIPLIERS[r][risk] = newArr;
        });
    }
}

// Variables Globales
const canvas = document.getElementById('plinko-canvas');
const ctx = canvas.getContext('2d');

let balance = 0; // Se iniciará con el saldo de Supabase
let mode = 'manual';
let autoInterval = null;
let isAutoPlaying = false;
let balls = [];
let pegs = [];
let buckets = [];

// ==========================================
// 2. LÓGICA DE AUTENTICACIÓN Y SALDOS DE SUPABASE
// ==========================================

async function verificarSesionYJugar() {
    document.getElementById('balance-text').innerText = "CARGANDO...";
    
    // 1. Verificamos si hay alguien logueado
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        // Redirigir si no está logueado
        window.location.href = 'index.html'; 
        return;
    }
    
    currentUser = session.user;

    // 2. Buscamos su saldo en la tabla "perfiles"
    const { data: perfilData } = await supabaseClient
        .from('perfiles')
        .select('saldo')
        .eq('id', currentUser.id)
        .single();

    if (perfilData) {
        balance = parseFloat(perfilData.saldo);
    } else {
        // Si no tiene perfil, le damos el bono inicial y lo creamos
        balance = 10000; 
        await guardarSaldoEnBD(); 
    }

    // Actualizar visualmente y continuar
    updateBalance(0);
}

// Función con UPSERT para crear o actualizar en Supabase
async function guardarSaldoEnBD() {
    if(!currentUser) return;
    
    await supabaseClient
        .from('perfiles')
        .upsert({ 
            id: currentUser.id, 
            saldo: balance 
        });
}

// ==========================================
// 3. FUNCIONES DEL JUEGO
// ==========================================

// Redimensionamiento responsive del Canvas
function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    updateBoard();
}

// Vincular Elementos del DOM e inicializar Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Al cargar la pantalla, iniciamos la verificación en Supabase
    verificarSesionYJugar();

    document.getElementById('tab-manual').addEventListener('click', () => setMode('manual'));
    document.getElementById('tab-auto').addEventListener('click', () => setMode('auto'));
    
    document.getElementById('risk-select').addEventListener('change', updateBoard);
    document.getElementById('rows-select').addEventListener('change', updateBoard);
    document.getElementById('play-btn').addEventListener('click', handlePlay);

    const betInput = document.getElementById('bet-amount');
    const betSlider = document.getElementById('bet-slider');
    const chips = document.querySelectorAll('.chip-btn');

    function updateSliderLimits() {
        betSlider.max = Math.max(0.1, balance).toFixed(2);
    }

    betSlider.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value) || 0.1;
        betInput.value = val.toFixed(2);
        clearActiveChips();
    });

    betInput.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value) || 0.1;
        betSlider.value = val;
        clearActiveChips();
    });

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            clearActiveChips();
            chip.classList.add('active');
            let pct = parseFloat(chip.dataset.pct) / 100;
            let calculatedBet = balance * pct;
            calculatedBet = Math.max(0.1, calculatedBet);
            
            betInput.value = calculatedBet.toFixed(2);
            betSlider.value = calculatedBet;
        });
    });

    function clearActiveChips() {
        chips.forEach(c => c.classList.remove('active'));
    }

    window.addEventListener('resize', resizeCanvas);

    updateSliderLimits();
    resizeCanvas();
    animate();
});

// Asignar colores a los multiplicadores
function getBucketColor(index, total) {
    const center = (total - 1) / 2;
    const dist = Math.abs(index - center) / center;
    
    if (dist > 0.8) return '#ff1543'; 
    if (dist > 0.6) return '#ff5e00'; 
    if (dist > 0.4) return '#ffa200'; 
    if (dist > 0.2) return '#ffcc00'; 
    return '#ffe600';                 
}

// Cambiar pestañas de modo
function setMode(newMode) {
    mode = newMode;
    document.getElementById('tab-manual').classList.toggle('active', mode === 'manual');
    document.getElementById('tab-auto').classList.toggle('active', mode === 'auto');
    
    if (isAutoPlaying) toggleAutoPlay();
    document.getElementById('play-btn').innerText = mode === 'auto' ? 'Start Auto' : 'Play';
}

// Actualizar visor de balance, sincronizar sliders y BD
function updateBalance(amount) {
    balance += amount;
    document.getElementById('balance-text').innerText = `$${balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const betSlider = document.getElementById('bet-slider');
    if (betSlider) {
        betSlider.max = Math.max(0.1, balance).toFixed(2);
    }

    // Guardar el saldo actualizado en Supabase si se realizó algún cambio real
    if (amount !== 0) {
        guardarSaldoEnBD();
    }
}

// Recalcular y dibujar la estructura geométrica del juego
function updateBoard() {
    pegs = [];
    buckets = [];
    const rowsSelect = document.getElementById('rows-select');
    const riskSelect = document.getElementById('risk-select');
    if (!rowsSelect || !riskSelect || !canvas.width || !canvas.height) return;

    const rows = parseInt(rowsSelect.value);
    const risk = riskSelect.value;
    const currentMultipliers = MULTIPLIERS[rows][risk];

    const startY = Math.max(30, canvas.height * 0.08);
    const availableHeight = canvas.height - startY - Math.max(40, canvas.height * 0.1);
    const spacingY = availableHeight / rows;
    
    for (let r = 0; r < rows; r++) {
        let rowPegs = [];
        let pegsInRow = r + 3;
        let totalWidth = (pegsInRow - 1) * (spacingY * 1.1);
        let startX = (canvas.width - totalWidth) / 2;

        for (let c = 0; c < pegsInRow; c++) {
            rowPegs.push({
                x: startX + c * (spacingY * 1.1),
                y: startY + r * spacingY,
                radius: Math.max(2, Math.min(4, spacingY * 0.15))
            });
        }
        pegs.push(rowPegs);
    }

    if (pegs.length > 0) {
        const lastRowPegs = pegs[pegs.length - 1];
        for (let i = 0; i < lastRowPegs.length - 1; i++) {
            let x1 = lastRowPegs[i].x;
            let x2 = lastRowPegs[i+1].x;
            buckets.push({
                x: (x1 + x2) / 2,
                y: lastRowPegs[0].y + spacingY * 0.6,
                width: (x2 - x1) * 0.9,
                height: Math.max(18, spacingY * 0.7),
                multiplier: currentMultipliers[i],
                color: getBucketColor(i, lastRowPegs.length - 1),
                pulse: 0
            });
        }
    }
}

// Acciones del botón Play
function handlePlay() {
    if (mode === 'manual') {
        spawnBall();
    } else {
        toggleAutoPlay();
    }
}

// Encendido y apagado de modo automático
function toggleAutoPlay() {
    const btn = document.getElementById('play-btn');
    if (!isAutoPlaying) {
        isAutoPlaying = true;
        btn.innerText = 'Stop Auto';
        btn.classList.add('auto-stop');
        spawnBall();
        autoInterval = setInterval(spawnBall, 400); 
    } else {
        isAutoPlaying = false;
        btn.innerText = 'Start Auto';
        btn.classList.remove('auto-stop');
        clearInterval(autoInterval);
    }
}

// Disparar una bola en el Canvas
function spawnBall() {
    const bet = parseFloat(document.getElementById('bet-amount').value);
    if (isNaN(bet) || bet <= 0 || balance < bet) {
        if (isAutoPlaying) toggleAutoPlay();
        return;
    }

    // Al lanzar la bola, restamos el monto apostado y se actualiza en la BD
    updateBalance(-bet);

    const rowsCount = pegs.length; 
    let currentCol = 1; 
    let path = [pegs[0][currentCol]];

    for (let r = 1; r < rowsCount; r++) {
        let dir = Math.random() < 0.5 ? 0 : 1;
        currentCol += dir;
        path.push(pegs[r][currentCol]);
    }

    let finalDir = Math.random() < 0.5 ? 0 : 1;
    let bucketIndex = (currentCol - 1) + finalDir;

    bucketIndex = Math.max(0, Math.min(buckets.length - 1, bucketIndex));
    let targetBucket = buckets[bucketIndex];

    path.push({
        x: targetBucket.x,
        y: targetBucket.y + 10, 
        bucketIndex: bucketIndex 
    });

    balls.push({
        path: path,
        step: 0,
        progress: 0,
        x: path[0].x,
        y: path[0].y,
        bet: bet,
        speed: 0.08 + Math.random() * 0.02
    });
}

// Bucle principal de Renderizado (60 FPS)
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#64748b';
    for (let r = 0; r < pegs.length; r++) {
        for (let c = 0; c < pegs[r].length; c++) {
            ctx.beginPath();
            ctx.arc(pegs[r][c].x, pegs[r][c].y, pegs[r][c].radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let i = 0; i < buckets.length; i++) {
        let b = buckets[i];
        
        if (b.pulse > 0) b.pulse -= 0.05;
        let offset = b.pulse * 5;

        ctx.fillStyle = b.color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(b.x - (b.width+offset)/2, b.y + offset/2, b.width + offset, b.height, 4);
        } else {
            ctx.rect(b.x - (b.width+offset)/2, b.y + offset/2, b.width + offset, b.height);
        }
        ctx.fill();

        ctx.fillStyle = '#000000';
        let fontSize = Math.max(8, Math.min(11, b.width * 0.35));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${b.multiplier}×`, b.x, b.y + b.height / 2 + offset/2);
    }

    for (let i = balls.length - 1; i >= 0; i--) {
        let ball = balls[i];
        let p1 = ball.path[ball.step];
        let p2 = ball.path[ball.step + 1];

        ball.progress += ball.speed;

        if (ball.progress >= 1) {
            ball.step++;
            ball.progress = 0;
            
            if (ball.step >= ball.path.length - 1) {
                let finalNode = ball.path[ball.path.length - 1];
                let bucket = buckets[finalNode.bucketIndex];
                if (bucket) {
                    bucket.pulse = 1; 
                    // Al caer la bola al bucket, se suma el premio y se actualiza la BD
                    updateBalance(ball.bet * bucket.multiplier);
                }
                balls.splice(i, 1);
                continue;
            }
            p1 = ball.path[ball.step];
            p2 = ball.path[ball.step + 1];
        }

        let t = ball.progress;
        ball.x = p1.x + (p2.x - p1.x) * t;
        
        let arc = 0;
        if (ball.step < ball.path.length - 2) {
            arc = Math.sin(t * Math.PI) * (pegs.length > 0 ? (canvas.height / pegs.length) * 0.35 : 12); 
        }
        ball.y = p1.y + (p2.y - p1.y) * t - arc;

        ctx.fillStyle = '#ffd700';       
        ctx.shadowColor = '#ffa500';     
        ctx.shadowBlur = 10;
        ctx.beginPath();
        let ballRadius = pegs.length > 0 ? Math.max(3, Math.min(6.5, (canvas.width / pegs[pegs.length-1].length) * 0.2)) : 6.5;
        ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2); 
        ctx.fill();
        ctx.shadowBlur = 0;              
    }

    requestAnimationFrame(animate);
}
