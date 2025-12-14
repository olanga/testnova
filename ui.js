import { currentDrills, userCustomDrills, appStats, drillOrder, saveDrillOrder } from './state.js';
import { bleState } from './bluetooth.js';
import { showToast } from './utils.js';
import { openEditor } from './editor.js';

export function renderDrillButtons() {
    // Render Basic, Combined, Complex (Sorting ENABLED)
    ['basic', 'combined', 'complex'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        
        // Use mutable drillOrder from state instead of immutable CATEGORIES
        if (drillOrder[cat]) {
            drillOrder[cat].forEach(key => {
                if (!currentDrills[key]) return; 
                createButton(container, key, formatDrillName(key), true, cat); // True = sorting enabled
            });
        }
    });

    // Render Custom (Sorting ENABLED)
    ['custom-a', 'custom-b', 'custom-c'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        if (userCustomDrills[cat].length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-light); font-size:0.8rem;">No drills imported.<br>Use Settings > Import</div>';
        } else {
            userCustomDrills[cat].forEach(item => {
                createButton(container, item.key, item.name, true, cat);
            });
        }
    });
}

function createButton(container, key, label, allowSort, category) {
    const btn = document.createElement('button');
    btn.className = 'btn-drill';
    btn.dataset.key = key;
    
    // 1. Left Icon (Visual)
    const iconDiv = document.createElement('div');
    iconDiv.className = 'drill-icon';
    for(let i=0; i<4; i++) {
        iconDiv.appendChild(document.createElement('div')).className = 'd-dot';
    }
    btn.appendChild(iconDiv);

    // 2. Text Label
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);

    // 3. Random Badge (Placed right of text, left of grip)
    if (currentDrills[key] && currentDrills[key].random) {
        const rMark = document.createElement('div');
        rMark.className = 'mark-random';
        rMark.textContent = 'R';
        btn.appendChild(rMark);
    }
    
    // 4. Grip Icon (Far Right) & Sorting Logic
    if (allowSort) {
        const grip = document.createElement('div');
        grip.className = 'drill-grab-handle';
        grip.innerHTML = '≡'; 
        grip.title = "Drag to reorder";
        
        // --- Drag & Drop Events ---
        btn.draggable = true;

        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            btn.classList.add('dragging');
        });

        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            handleReorder(container, category);
        });
        
        btn.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            const draggingItem = container.querySelector('.dragging');
            if (draggingItem && draggingItem !== btn) {
                const box = btn.getBoundingClientRect();
                const offset = e.clientY - box.top - (box.height / 2);
                if (offset < 0) {
                    container.insertBefore(draggingItem, btn);
                } else {
                    container.insertBefore(draggingItem, btn.nextSibling);
                }
            }
        });

        // Prevent click events on grip
        grip.onclick = (e) => e.stopPropagation();
        grip.onmousedown = (e) => e.stopPropagation(); 

        // Note: We do NOT stop propagation on touchstart here, 
        // as that might break mobile drag-and-drop polyfills.
        // Instead, we handle the exclusion in the 'start' function below.

        btn.appendChild(grip);
    }
    
    // Interactions (Click to run)
    btn.onclick = (e) => {
        if(btn.classList.contains('dragging')) return;
        window.handleDrillClick(key, btn);
    };

    // Long Press for Editor
    let pressTimer;
    
    // UPDATED: 'start' now accepts 'e' and checks for grip handle
    const start = (e) => {
        // FIX: If touching the sort handle, do NOT start the editor timer
        if (e.target.closest('.drill-grab-handle')) return;

        if(btn.classList.contains('running')) return;
        pressTimer = setTimeout(() => openEditor(key), 600);
    };
    const end = () => clearTimeout(pressTimer);
    
    btn.onmousedown = start;
    btn.ontouchstart = start; // This passes 'e' to start
    btn.onmouseup = end;
    btn.onmouseleave = end;
    btn.ontouchend = end;

    container.appendChild(btn);
}

function handleReorder(container, category) {
    // 1. Read new order from DOM
    const buttons = Array.from(container.querySelectorAll('.btn-drill'));
    const newKeys = buttons.map(b => b.dataset.key);
    
    // 2. Logic Split: Preprogrammed vs Custom
    if (['basic', 'combined', 'complex'].includes(category)) {
        // Update the sequence list directly
        drillOrder[category] = newKeys;
        saveDrillOrder();
    } else {
        // Custom drills are array of objects, map keys back to objects
        const oldList = userCustomDrills[category];
        const newList = [];
        newKeys.forEach(k => {
            const item = oldList.find(d => d.key === k);
            if(item) newList.push(item);
        });
        userCustomDrills[category] = newList;
        localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
    }
}

export function updateDrillButtonStates() {
    const btns = document.querySelectorAll('.btn-drill');
    btns.forEach(b => {
         b.style.opacity = bleState.isConnected ? "1" : "0.6"; 
    });
    
    const btnConnect = document.getElementById('btn-connect');
    const statusText = document.getElementById('status-text');
    
    if (btnConnect && statusText) {
        if (bleState.isConnected) {
            btnConnect.textContent = "Disconnect";
            btnConnect.classList.add('connected');
            statusText.textContent = "Connected";
            statusText.style.color = "#00b894";
        } else {
            btnConnect.textContent = "Connect";
            btnConnect.classList.remove('connected');
            statusText.textContent = "Disconnected";
            statusText.style.color = "var(--text-light)";
        }
    }
}

export function updateStatsUI() {
    const el = document.getElementById('stats-display');
    if(el) el.textContent = `Balls: ${appStats.balls} | Drills: ${appStats.drills}`;
}

export function toggleMenu() {
    const m = document.getElementById('theme-menu');
    if(m) m.classList.toggle('open');
}

export function setTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('nova_theme_pref', themeName);
    toggleMenu();
}

export function switchTab(catName, btn) {
    const tabs = ['basic','combined','complex','custom-a','custom-b','custom-c'];
    tabs.forEach(c => {
        const el = document.getElementById('view-'+c);
        if(el) el.classList.add('hidden');
    });
    const target = document.getElementById('view-' + catName);
    if(target) target.classList.remove('hidden');
    
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    if(btn) btn.classList.add('active');

    const diffGroup = document.getElementById('grp-difficulty');
    if(diffGroup) {
        // Hide difficulty selector for custom drills as they have internal physics
        diffGroup.style.display = ['custom-a', 'custom-b', 'custom-c'].includes(catName) ? 'none' : 'flex';
    }
}

function formatDrillName(key) {
    if (key.startsWith('cust_')) return key; 
    return key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}