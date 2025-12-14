import { currentDrills, userCustomDrills, appStats, drillOrder, saveDrillOrder, saveDrillsToStorage } from './state.js';
import { bleState } from './bluetooth.js';
import { showToast } from './utils.js';
import { openEditor } from './editor.js';

// --- NEW: Drag & Drop to Tab Handlers ---

window.allowTabDrop = (e) => {
    e.preventDefault(); // Necessary to allow dropping
};

window.handleTabDrop = (e, targetCat) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain');
    if (!key) return;

    // 1. Find Source Category
    let sourceCat = null;
    let drillObj = null;
    let drillIndex = -1;

    ['custom-a', 'custom-b', 'custom-c'].forEach(cat => {
        const idx = userCustomDrills[cat].findIndex(d => d.key === key);
        if (idx !== -1) {
            sourceCat = cat;
            drillIndex = idx;
            drillObj = userCustomDrills[cat][idx];
        }
    });

    // Validations
    if (!sourceCat) return; // Not a custom drill (cannot move Basic/Combined)
    if (sourceCat === targetCat) return; // Dropped on same tab
    if (userCustomDrills[targetCat].length >= 20) {
        showToast(`Bank ${targetCat.split('-')[1].toUpperCase()} is full!`);
        return;
    }

    // 2. Generate New Key for Target Category
    // Format: cust_A_Name -> cust_B_Name
    const targetChar = targetCat.split('-')[1].toUpperCase();
    let newKey = key.replace(/^cust_[ABC]_/i, `cust_${targetChar}_`);
    
    // Ensure Uniqueness
    if (currentDrills[newKey]) {
        newKey = `${newKey}_${Date.now()}`;
    }

    // 3. Move Data in State
    // A. Copy drill parameters
    currentDrills[newKey] = JSON.parse(JSON.stringify(currentDrills[key]));
    
    // B. Add to target list
    userCustomDrills[targetCat].push({
        name: drillObj.name,
        key: newKey
    });

    // C. Remove from source list
    userCustomDrills[sourceCat].splice(drillIndex, 1);
    
    // D. Delete old drill parameters
    delete currentDrills[key];

    // 4. Persist
    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
    saveDrillsToStorage();

    // 5. Update UI
    renderDrillButtons(); // Refresh current view (item will disappear)
    showToast(`Moved to ${targetChar}`);
    
    // Optional: Switch to the target tab to show the item
    const targetBtn = document.querySelector(`.tab-btn[onclick*="${targetCat}"]`);
    if(targetBtn) switchTab(targetCat, targetBtn);
};

// --- EXISTING UI LOGIC ---

export function renderDrillButtons() {
    // Render Basic, Combined, Complex (Sorting ENABLED)
    ['basic', 'combined', 'complex'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        
        if (drillOrder[cat]) {
            drillOrder[cat].forEach(key => {
                if (!currentDrills[key]) return; 
                createButton(container, key, formatDrillName(key), true, cat); 
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
    
    // 1. Left Icon
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

    // 3. Random Badge
    if (currentDrills[key] && currentDrills[key].random) {
        const rMark = document.createElement('div');
        rMark.className = 'mark-random';
        rMark.textContent = 'R';
        btn.appendChild(rMark);
    }
    
    // 4. Grip Icon & Sorting Logic
    if (allowSort) {
        const grip = document.createElement('div');
        grip.className = 'drill-grab-handle';
        grip.innerHTML = '≡'; 
        grip.title = "Drag to reorder";
        
        // DRAG LOGIC
        btn.draggable = false; // Default: disable drag to allow long-press on text

        const enableDrag = () => { btn.draggable = true; };
        const disableDrag = () => { btn.draggable = false; };

        grip.addEventListener('mousedown', enableDrag);
        grip.addEventListener('touchstart', enableDrag, {passive: true});
        grip.addEventListener('mouseup', disableDrag);
        grip.addEventListener('mouseleave', disableDrag);
        grip.addEventListener('touchend', disableDrag);

        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key); // Essential for Tab Drop
            btn.classList.add('dragging');
        });

        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            btn.draggable = false; 
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

        grip.onclick = (e) => e.stopPropagation();
        btn.appendChild(grip);
    }
    
    // Click Interaction
    btn.onclick = (e) => {
        if(btn.classList.contains('dragging')) return;
        window.handleDrillClick(key, btn);
    };

    // Long Press Editor
    let pressTimer;
    const start = (e) => {
        if (e.target.closest('.drill-grab-handle')) return;
        if(btn.classList.contains('running')) return;
        pressTimer = setTimeout(() => openEditor(key), 1000);
    };
    const end = () => clearTimeout(pressTimer);
    
    btn.onmousedown = start;
    btn.ontouchstart = start; 
    btn.onmouseup = end;
    btn.onmouseleave = end;
    btn.ontouchend = end;

    container.appendChild(btn);
}

function handleReorder(container, category) {
    const buttons = Array.from(container.querySelectorAll('.btn-drill'));
    const newKeys = buttons.map(b => b.dataset.key);
    
    // If the list size changed (item moved out to a tab), don't reorder here.
    // The handleTabDrop function handles the removal.
    // We only reorder if the count matches.
    
    if (['basic', 'combined', 'complex'].includes(category)) {
        if(newKeys.length === drillOrder[category].length) {
            drillOrder[category] = newKeys;
            saveDrillOrder();
        }
    } else {
        if(newKeys.length === userCustomDrills[category].length) {
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
        diffGroup.style.display = ['custom-a', 'custom-b', 'custom-c'].includes(catName) ? 'none' : 'flex';
    }
}

function formatDrillName(key) {
    if (key.startsWith('cust_')) return key; 
    return key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}