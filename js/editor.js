import { currentDrills, userCustomDrills, selectedLevel, saveDrillsToStorage } from './state.js';
import { RANGE_CONFIG } from './constants.js';
import { sendPacket, packBall, bleState } from './bluetooth.js';
import { showToast, clamp } from './utils.js';

// --- Local State ---
let tempDrillData = null;
let editingDrillKey = null;

// --- Public Module Functions ---

export function openEditor(key) {
    editingDrillKey = key;
    
    // --- 1. SET DRILL NAME IN TITLE ---
    const titleEl = document.querySelector('.modal-title');
    if (titleEl) {
        updateTitleDisplay(titleEl, key);
        
        // --- RENAME LISTENER (Double Click / Double Tap) ---
        // Prevents highlighting text on double tap
        titleEl.style.userSelect = 'none';
        titleEl.style.webkitUserSelect = 'none';
        
        // Standard event works on both PC (click) and Mobile (tap)
        titleEl.ondblclick = () => handleRename(titleEl);
    }

    // --- 2. LOAD DATA ---
    const chk = document.getElementById('chk-drill-random');
    if (chk) chk.checked = !!currentDrills[key].random;

    if (currentDrills[key] && currentDrills[key][selectedLevel]) {
        // Deep copy data to tempDrillData
        tempDrillData = JSON.parse(JSON.stringify(currentDrills[key][selectedLevel]));
    } else {
        // Fallback default
        tempDrillData = [[[1500, 3000, 50, 0, 50, 1]]];
    }

    renderEditor();
    document.getElementById('editor-modal').classList.add('open');
}

export function closeEditor() {
    document.getElementById('editor-modal').classList.remove('open');
    editingDrillKey = null;
    tempDrillData = null;
}

export function saveDrillChanges() {
    if (!editingDrillKey || !tempDrillData) return;

    const chk = document.getElementById('chk-drill-random');
    if (chk) currentDrills[editingDrillKey].random = chk.checked;

    // Sanitize Data (Clamp all values)
    tempDrillData.forEach(step => {
        step.forEach(ball => {
            ball[0] = clamp(ball[0], 400, 7500); 
            ball[1] = clamp(ball[1], 400, 7500); 
            ball[2] = clamp(ball[2], -50, 100);  
            ball[3] = clamp(ball[3], -10, 10);   
            ball[4] = clamp(ball[4], 0, 100);    
            ball[5] = clamp(ball[5], 1, 200);    
        });
    });

    currentDrills[editingDrillKey][selectedLevel] = tempDrillData;
    saveDrillsToStorage();

    closeEditor();
    showToast(`Saved Level ${selectedLevel}`);
    
    // Notify main to refresh UI
    document.dispatchEvent(new CustomEvent('drills-updated'));
}

// --- Renaming Logic ---

function handleRename(titleEl) {
    // Only allow renaming Custom drills (starting with cust_)
    if (!editingDrillKey || !editingDrillKey.startsWith('cust_')) {
        showToast("Cannot rename factory drills");
        return;
    }

    const currentDisplayName = titleEl.title;
    const newName = prompt("Rename Drill (Max 32 chars)\nAllowed: a-z A-Z 0-9 . - # [ ] > < + ) ( Space", currentDisplayName);

    if (!newName || newName === currentDisplayName) return;

    // 1. Validation
    if (newName.length > 32) { 
        showToast("Name too long (Max 32)");
        return;
    }
    
    // Allowed: a-z, A-Z, 0-9, . - # [ ] > < + ) ( Space
    const validRegex = /^[a-zA-Z0-9.\-#\[\]><\+\)\( ]+$/;
    
    if (!validRegex.test(newName)) {
        showToast("Invalid characters");
        return;
    }

    // 2. Identify Category
    const parts = editingDrillKey.split('_'); // e.g. ["cust", "A", "Name"]
    if (parts.length < 3) return;
    
    const catChar = parts[1]; // "A", "B", or "C"
    const catListKey = `custom-${catChar.toLowerCase()}`;
    const list = userCustomDrills[catListKey];
    
    if (!list) return;

    // 3. Check Uniqueness & Generate Key
    const newKey = `cust_${catChar}_${newName}`;
    
    if (currentDrills[newKey] && newKey !== editingDrillKey) {
        showToast("Name already exists");
        return;
    }

    // 4. Update Data Structures
    // A. Update the list entry
    const entry = list.find(d => d.key === editingDrillKey);
    if (entry) {
        entry.name = newName;
        entry.key = newKey;
    }

    // B. Move Drill Data to new Key
    currentDrills[newKey] = currentDrills[editingDrillKey];
    delete currentDrills[editingDrillKey];

    // C. Persist Changes
    editingDrillKey = newKey;
    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills)); // Save List
    saveDrillsToStorage(); // Save Drill Data

    // D. Update UI
    updateTitleDisplay(titleEl, newKey);
    showToast("Renamed Successfully");
    document.dispatchEvent(new CustomEvent('drills-updated'));
}

function updateTitleDisplay(el, key) {
    let displayName = key;
    if (key.startsWith('cust_')) {
        // Find name in userCustomDrills or fallback to parsing key
        const parts = key.split('_');
        if (parts.length >= 3) {
           // Try to find the real name in the list (handles underscores vs spaces if relevant)
           const catKey = `custom-${parts[1].toLowerCase()}`;
           const entry = userCustomDrills[catKey]?.find(d => d.key === key);
           displayName = entry ? entry.name : key.replace(/^cust_[A-C]_/, '');
        }
    } else {
        displayName = key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    el.textContent = `Edit: ${displayName}`;
    el.title = displayName;
}

// --- Internal Rendering Logic ---

function renderEditor() {
    const modalBody = document.getElementById('editor-body');
    modalBody.innerHTML = '';
    
    const isConnected = bleState.isConnected;

    tempDrillData.forEach((stepOptions, stepIndex) => {
        
        // --- 1. Swap Zone (Between balls) ---
        if (stepIndex > 0) {
            const swapDiv = document.createElement('div');
            swapDiv.className = 'swap-zone';
            swapDiv.innerHTML = `<button class="btn-swap" onclick="window.handleSwapSteps(${stepIndex - 1}, ${stepIndex})" title="Swap Order">⇅</button>`;
            modalBody.appendChild(swapDiv);
        }

        // --- 2. Group Header ---
        const groupDiv = document.createElement('div');
        groupDiv.className = 'ball-group';
        
        const isSingle = stepOptions.length === 1;
        const plusBtn = isSingle 
            ? `<button class="btn-add-opt" onclick="window.handleAddOption(${stepIndex})" title="Add Variation">+</button>` 
            : '';

        groupDiv.innerHTML = `
            <div class="group-title">
                <span>Ball ${stepIndex + 1}</span>
                ${plusBtn}
            </div>`;

        // --- 3. Render Options ---
        stepOptions.forEach((ballParams, optIndex) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'option-card';
            
            // Grid of Inputs
            let gridHtml = '<div class="editor-grid">';
            RANGE_CONFIG.forEach(cfg => {
                gridHtml += `
                    <div class="editor-field">
                        <div class="field-header">
                            <label>${cfg.label}</label>
                            <span class="range-hint">${cfg.min}-${cfg.max}</span>
                        </div>
                        <input type="number" 
                               class="${cfg.class}" 
                               value="${ballParams[cfg.idx]}" 
                               min="${cfg.min}" max="${cfg.max}" step="${cfg.step}"
                               oninput="window.handleEditorInput(${stepIndex}, ${optIndex}, ${cfg.idx}, this.value)">
                    </div>
                `;
            });
            gridHtml += '</div>';

            const isLastBall = tempDrillData.length === 1 && stepOptions.length === 1;

            const actionsHtml = `
                <div class="card-actions">
                     <button class="btn-action btn-act-test" 
                             onclick="window.handleTestBall(${stepIndex}, ${optIndex})" 
                             ${isConnected ? '' : 'disabled'}>Test</button>
                             
                     <button class="btn-action btn-act-clone" 
                             onclick="window.handleCloneBall(${stepIndex}, ${optIndex})">Clone</button>
                             
                     <button class="btn-action btn-act-del" 
                             onclick="window.handleDeleteBall(${stepIndex}, ${optIndex})" 
                             ${isLastBall ? 'disabled' : ''}>Delete</button>
                </div>
            `;

            const label = stepOptions.length > 1 ? `<span class="option-label">Option ${optIndex + 1}</span>` : '';

            optDiv.innerHTML = label + gridHtml + actionsHtml;
            groupDiv.appendChild(optDiv);
        });

        modalBody.appendChild(groupDiv);
    });
}

// --- Window Global Handlers ---

window.handleEditorInput = (stepIdx, optIdx, paramIdx, value) => {
    if (!tempDrillData) return;
    let val = parseFloat(value);
    if (isNaN(val)) return;
    if (paramIdx !== 3) val = parseInt(value); 
    tempDrillData[stepIdx][optIdx][paramIdx] = val;
};

window.handleSwapSteps = (idxA, idxB) => {
    if (!tempDrillData) return;
    [tempDrillData[idxA], tempDrillData[idxB]] = [tempDrillData[idxB], tempDrillData[idxA]];
    renderEditor(); 
};

window.handleAddOption = (stepIndex) => {
    const baseOption = [...tempDrillData[stepIndex][0]];
    tempDrillData[stepIndex].push(baseOption);
    renderEditor();
};

window.handleCloneBall = (stepIdx, optIdx) => {
    const ballConfig = [...tempDrillData[stepIdx][optIdx]];
    
    if (tempDrillData[stepIdx].length > 1) {
        tempDrillData[stepIdx].splice(optIdx + 1, 0, ballConfig);
    } else {
        const newStep = [ballConfig];
        tempDrillData.splice(stepIdx + 1, 0, newStep);
    }
    renderEditor();
};

window.handleDeleteBall = (stepIdx, optIdx) => {
    if (tempDrillData.length <= 1 && tempDrillData[0].length <= 1) {
        showToast("Cannot delete the last ball");
        return;
    }
    tempDrillData[stepIdx].splice(optIdx, 1);
    if (tempDrillData[stepIdx].length === 0) {
        tempDrillData.splice(stepIdx, 1);
    }
    renderEditor();
};

window.handleTestBall = async (stepIdx, optIdx) => {
    if (!bleState.isConnected) {
        showToast("Device not connected");
        return;
    }
    
    const d = tempDrillData[stepIdx][optIdx];
    
    // Construct Packet manually (Protocol Header + Ball Data)
    const ballData = packBall(d[0], d[1], d[2], d[3], d[4], 1); 
    
    const buffer = new ArrayBuffer(31); 
    const view = new DataView(buffer);
    
    // Header
    view.setUint8(0, 0x81); 
    view.setUint16(1, 28, true); // Length (4 + 24)
    view.setUint8(3, 1); 
    view.setUint16(4, 1, true); 
    view.setUint8(6, 0);
    
    // Payload
    new Uint8Array(buffer).set(ballData, 7);
    
    try {
        await sendPacket(new Uint8Array(buffer));
        showToast("Test Ball Fired");
    } catch (e) {
        console.error(e);
        showToast("Test Failed");
    }
};