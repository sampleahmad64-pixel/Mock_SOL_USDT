// ==========================================
// NEXUS MOCK TERMINAL - CORE LOGIC
// ==========================================

let currentPrice = 0.0;
let positions = [];
let tradeHistory = [];
let nextPosId = 1;

// DOM Elements
const elLivePrice = document.getElementById('live-price');
const elBigPrice = document.getElementById('big-price');
const elOrderQty = document.getElementById('order-qty');
const elPosTitle = document.getElementById('position-tab-title');
const elPosBody = document.getElementById('positions-body');

const elHistoryBody = document.getElementById('history-body');
const tabPositions = document.getElementById('tab-positions');
const tabHistory = document.getElementById('tab-history');
const contentPositions = document.getElementById('content-positions');
const contentHistory = document.getElementById('content-history');

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

function handlePriceUpdate(priceStr) {
    if (!priceStr) return;
    const newPrice = parseFloat(priceStr);
    if (isNaN(newPrice)) return;
    
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
    
    updatePositionsUI();
}

function fetchPriceFallback() {
    fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=SOLUSDT')
        .then(res => res.json())
        .then(data => {
            if (data && data.price) handlePriceUpdate(data.price);
        })
        .catch(err => console.error("REST error:", err));
}

// Always poll every 1 second to guarantee the price updates even if WS is blocked
setInterval(fetchPriceFallback, 1000);
fetchPriceFallback();

function connectWebSocket() {
    ws = new WebSocket('wss://fstream.binance.com/ws/solusdt@aggTrade');
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.p) handlePriceUpdate(data.p);
        } catch (err) {}
    };
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
}
connectWebSocket();

// ==========================================
// POSITION MANAGEMENT (ONE-WAY MODE)
// ==========================================
function openPosition(orderDirection, orderQty) {
    if (orderQty <= 0 || currentPrice <= 0) return;

    if (positions.length > 0) {
        const pos = positions[0]; // One-Way mode: only 1 position at a time
        
        if (pos.direction === orderDirection) {
            // Increase position size
            const totalValueOld = pos.qty * pos.entry;
            const totalValueNew = orderQty * currentPrice;
            pos.qty += orderQty;
            pos.entry = (totalValueOld + totalValueNew) / pos.qty;
            showNotification(`Increased ${orderDirection.toUpperCase()} by ${orderQty} SOL`);
        } else {
            // Reduce or Flip position
            if (orderQty < pos.qty) {
                // Partial close
                const realizedPnl = calculateRealizedPnl(pos.direction, pos.entry, currentPrice, orderQty);
                pos.qty -= orderQty;
                addToHistory(pos.direction, orderQty, pos.entry, currentPrice, realizedPnl);
                showNotification(`Reduced ${pos.direction.toUpperCase()} by ${orderQty} SOL. Realized PNL: ${realizedPnl > 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`, realizedPnl >= 0 ? 'up' : 'down');
            } else if (orderQty === pos.qty) {
                // Full close
                const realizedPnl = calculateRealizedPnl(pos.direction, pos.entry, currentPrice, pos.qty);
                addToHistory(pos.direction, pos.qty, pos.entry, currentPrice, realizedPnl);
                positions = [];
                showNotification(`Closed ${pos.direction.toUpperCase()} position. Realized PNL: ${realizedPnl > 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`, realizedPnl >= 0 ? 'up' : 'down');
            } else {
                // Flip position (Close current, open new in opposite direction)
                const realizedPnl = calculateRealizedPnl(pos.direction, pos.entry, currentPrice, pos.qty);
                const remainingQty = orderQty - pos.qty;
                
                addToHistory(pos.direction, pos.qty, pos.entry, currentPrice, realizedPnl);
                showNotification(`Flipped position. Realized PNL: ${realizedPnl > 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`, realizedPnl >= 0 ? 'up' : 'down');
                
                positions = [{
                    id: nextPosId++,
                    symbol: 'SOLUSDT',
                    direction: orderDirection,
                    qty: remainingQty,
                    entry: currentPrice
                }];
            }
        }
    } else {
        // Open new position
        positions.push({
            id: nextPosId++,
            symbol: 'SOLUSDT',
            direction: orderDirection,
            qty: orderQty,
            entry: currentPrice
        });
        showNotification(`Opened ${orderDirection.toUpperCase()} for ${orderQty} SOL`);
    }

    updatePositionsUI();
}

function calculateRealizedPnl(direction, entryPrice, exitPrice, qty) {
    if (direction === 'long') {
        return (exitPrice - entryPrice) * qty;
    } else {
        return (entryPrice - exitPrice) * qty;
    }
}

function closePosition(id) {
    const pos = positions.find(p => p.id === id);
    if (pos) {
        const realizedPnl = calculateRealizedPnl(pos.direction, pos.entry, currentPrice, pos.qty);
        addToHistory(pos.direction, pos.qty, pos.entry, currentPrice, realizedPnl);
        positions = [];
        showNotification(`Flash Closed ${pos.direction.toUpperCase()}. Realized PNL: ${realizedPnl > 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`, realizedPnl >= 0 ? 'up' : 'down');
        updatePositionsUI();
    }
}

function showNotification(msg, colorClass = 'up') {
    const notif = document.createElement('div');
    notif.className = `notification glass ${colorClass}`;
    notif.innerText = msg;
    document.body.appendChild(notif);
    
    // Animate in
    setTimeout(() => notif.style.opacity = '1', 10);
    // Remove after 4s
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 300);
    }, 4000);
}

function updatePositionsUI() {
    const count = positions.length;
    elPosTitle.innerText = `Positions(${count})`;
    elPosBody.innerHTML = '';

    positions.forEach(pos => {
        const pnl = calculateRealizedPnl(pos.direction, pos.entry, currentPrice, pos.qty);
        const pnlClass = pnl >= 0 ? 'up' : 'down';
        const pnlSign = pnl >= 0 ? '+' : '';
        const pnlFormatted = `${pnlSign}${pnl.toFixed(4)} USDT`;

        const row = document.createElement('tr');
        row.className = 'position-row position';
        
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

function addToHistory(direction, closedQty, entryPrice, exitPrice, realizedPnl) {
    const date = new Date();
    const timeStr = date.toLocaleTimeString();
    
    tradeHistory.unshift({ // Add to top
        time: timeStr,
        symbol: 'SOLUSDT',
        direction: direction,
        qty: closedQty,
        entry: entryPrice,
        exit: exitPrice,
        pnl: realizedPnl
    });
    
    // Keep max 50 history rows
    if (tradeHistory.length > 50) tradeHistory.pop();
    updateHistoryUI();
}

function updateHistoryUI() {
    if (!elHistoryBody) return;
    elHistoryBody.innerHTML = '';
    
    tradeHistory.forEach(trade => {
        const pnlClass = trade.pnl >= 0 ? 'up' : 'down';
        const pnlSign = trade.pnl >= 0 ? '+' : '';
        const pnlFormatted = `${pnlSign}${trade.pnl.toFixed(4)} USDT`;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${trade.time}</td>
            <td>
                <span class="${trade.direction === 'long' ? 'up' : 'down'} font-bold">
                    ${trade.direction.toUpperCase()}
                </span> 
                ${trade.symbol}
            </td>
            <td>${trade.direction.toUpperCase()}</td>
            <td>${trade.qty.toFixed(2)}</td>
            <td>${trade.entry.toFixed(4)}</td>
            <td>${trade.exit.toFixed(4)}</td>
            <td class="pos-pnl ${pnlClass}">${pnlFormatted}</td>
        `;
        elHistoryBody.appendChild(row);
    });
}

// ==========================================
// MODAL & BUTTON HANDLERS
// ==========================================
document.getElementById('btn-long').addEventListener('click', () => {
    const qty = parseFloat(elOrderQty.value) || 0;
    if (qty > 0) {
        openPosition('long', qty);
    }
});

document.getElementById('btn-short').addEventListener('click', () => {
    const qty = parseFloat(elOrderQty.value) || 0;
    if (qty > 0) {
        openPosition('short', qty);
    }
});

function triggerClose(id) {
    closePosition(id);
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

if (tabPositions && tabHistory) {
    tabPositions.addEventListener('click', () => {
        tabPositions.classList.add('active');
        tabHistory.classList.remove('active');
        contentPositions.classList.remove('hidden');
        contentHistory.classList.add('hidden');
    });

    tabHistory.addEventListener('click', () => {
        tabHistory.classList.add('active');
        tabPositions.classList.remove('active');
        contentHistory.classList.remove('hidden');
        contentPositions.classList.add('hidden');
    });
}

// Initial empty render
updatePositionsUI();
updateHistoryUI();
