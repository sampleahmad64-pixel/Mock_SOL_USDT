// ==========================================
// NEXUS MOCK TERMINAL - CORE LOGIC
// ==========================================

let currentPrice = 0.0;
let positions = [];
let nextPosId = 1;

// DOM Elements
const elLivePrice = document.getElementById('live-price');
const elBigPrice = document.getElementById('big-price');
const elOrderQty = document.getElementById('order-qty');
const elPosCount = document.getElementById('pos-count');
const elPosTitle = document.getElementById('position-tab-title');
const elPosBody = document.getElementById('positions-body');

const modal = document.getElementById('confirm-modal');
const modalText = document.getElementById('modal-text');
let pendingAction = null;

// ==========================================
// BINANCE WEBSOCKET - REALTIME PRICE
// ==========================================
// ==========================================
// BINANCE WEBSOCKET & REST FALLBACK
// ==========================================
let ws;
let fallbackInterval;

function handlePriceUpdate(priceStr) {
    if (!priceStr) return;
    const newPrice = parseFloat(priceStr);
    if (isNaN(newPrice)) return;
    
    // Update UI Colors
    if (currentPrice > 0) {
        if (newPrice > currentPrice) {
            elLivePrice.className = 'live-price up';
            elBigPrice.className = 'big-price up';
        } else if (newPrice < currentPrice) {
            elLivePrice.className = 'live-price down';
            elBigPrice.className = 'big-price down';
        }
    }
    
    currentPrice = newPrice;
    
    const formattedPrice = currentPrice.toFixed(4);
    elLivePrice.innerText = formattedPrice;
    elBigPrice.innerText = formattedPrice;

    // Recalculate PnL on every tick
    updatePositionsUI();
}

function fetchPriceFallback() {
    fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=SOLUSDT')
        .then(res => res.json())
        .then(data => {
            if (data && data.price) {
                handlePriceUpdate(data.price);
            }
        })
        .catch(err => console.error("REST Fallback error:", err));
}

function connectWebSocket() {
    // Using Binance Futures Stream (fstream) for aggTrade (updates on every trade)
    ws = new WebSocket('wss://fstream.binance.com/ws/solusdt@aggTrade');
    
    ws.onopen = () => {
        console.log("Connected to Binance WebSocket");
        // Clear fallback polling if WS successfully connects
        if (fallbackInterval) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error: ", error);
    };

    ws.onclose = () => {
        console.log("WebSocket connection closed. Reconnecting...");
        // Start REST API polling while WS is down
        if (!fallbackInterval) {
            fetchPriceFallback(); // immediate fetch
            fallbackInterval = setInterval(fetchPriceFallback, 2000);
        }
        setTimeout(connectWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // aggTrade uses 'p' for price
            if (data.p) {
                handlePriceUpdate(data.p);
            }
        } catch (err) {
            console.error("Error processing websocket message:", err);
        }
    };
}

// Start with REST fetch to get initial price instantly
fetchPriceFallback();
// Then connect WS for live stream
connectWebSocket();

// ==========================================
// POSITION MANAGEMENT
// ==========================================
function openPosition(direction, qty) {
    if (qty <= 0 || currentPrice <= 0) return;

    // Check if we already have a position in this direction
    const existing = positions.find(p => p.direction === direction);
    if (existing) {
        // Average entry price
        const totalValueOld = existing.qty * existing.entry;
        const totalValueNew = qty * currentPrice;
        existing.qty += qty;
        existing.entry = (totalValueOld + totalValueNew) / existing.qty;
    } else {
        positions.push({
            id: nextPosId++,
            symbol: 'SOLUSDT',
            direction: direction,
            qty: qty,
            entry: currentPrice
        });
    }

    updatePositionsUI();
}

function closePosition(id) {
    positions = positions.filter(p => p.id !== id);
    updatePositionsUI();
}

function updatePositionsUI() {
    // Update counts
    const count = positions.length;
    elPosCount.innerText = count;
    elPosTitle.innerText = `Positions(${count})`;

    // Rebuild rows
    elPosBody.innerHTML = '';

    positions.forEach(pos => {
        let pnl = 0;
        if (pos.direction === 'long') {
            pnl = (currentPrice - pos.entry) * pos.qty;
        } else {
            pnl = (pos.entry - currentPrice) * pos.qty;
        }

        const pnlClass = pnl >= 0 ? 'up' : 'down';
        const pnlSign = pnl >= 0 ? '+' : '';
        const pnlFormatted = `${pnlSign}${pnl.toFixed(4)} USDT`;

        const row = document.createElement('tr');
        row.className = 'position-row position'; // For extension XPath
        
        row.innerHTML = `
            <td>
                <span class="${pos.direction === 'long' ? 'up' : 'down'} font-bold">
                    ${pos.direction.toUpperCase()}
                </span> 
                ${pos.symbol}
            </td>
            <td>${pos.qty.toFixed(2)}</td>
            <td>${pos.entry.toFixed(4)}</td>
            <td>${currentPrice.toFixed(4)}</td>
            <td class="pos-pnl ${pnlClass}">${pnlFormatted}</td>
            <td>
                <button class="flash-close-btn" onclick="triggerClose(${pos.id})">
                    <span>Flash Close</span>
                </button>
            </td>
        `;
        
        elPosBody.appendChild(row);
    });
}

// ==========================================
// MODAL & BUTTON HANDLERS
// ==========================================
document.getElementById('btn-long').addEventListener('click', () => {
    const qty = parseFloat(elOrderQty.value) || 0;
    if (qty > 0) {
        pendingAction = () => openPosition('long', qty);
        showModal(`Are you sure you want to open a LONG position for ${qty} SOLUSDT?`);
    }
});

document.getElementById('btn-short').addEventListener('click', () => {
    const qty = parseFloat(elOrderQty.value) || 0;
    if (qty > 0) {
        pendingAction = () => openPosition('short', qty);
        showModal(`Are you sure you want to open a SHORT position for ${qty} SOLUSDT?`);
    }
});

function triggerClose(id) {
    pendingAction = () => closePosition(id);
    showModal(`Are you sure you want to close this position at Market Price?`);
}

function showModal(text) {
    modalText.innerText = text;
    modal.classList.remove('hidden');
}

function hideModal() {
    modal.classList.add('hidden');
    pendingAction = null;
}

document.getElementById('btn-confirm').addEventListener('click', () => {
    if (pendingAction) pendingAction();
    hideModal();
});

document.getElementById('modal-close').addEventListener('click', hideModal);

// Initial empty render
updatePositionsUI();
