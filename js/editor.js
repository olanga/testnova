import { currentDrills, selectedLevel, saveDrillsToStorage } from './state.js';
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
        let displayName = key;
        
        // Formatting Logic
        if (key.startsWith('cust_')) {
            // Custom: "cust_A_My_Drill" -> "My Drill"
            displayName = key.replace(/^cust_[A-C]_/, '').replace(/_/g, ' ');
        } else {
            // Built-in: "push(f)" -> "Push(f)"
            displayName = key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        
        titleEl.textContent = `Edit: ${displayName}`;
        titleEl.title = displayName; // Tooltip for very long names
    }

    // --- 2. LOAD DATA ---
    const chk = document.getElementById('chk-drill-random');
    if (chk) chk.checked = !!currentDrills[key].random;

    if (currentDrills[key] && currentDrills[key][selectedLevel]) {
        tempDrillData = JSON.parse(JSON.stringify(currentDrills[key][selectedLevel]));
    } else {
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

    // Sanitize Data
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
    
    // Notify main to refresh UI (e.g. "R" marks)
    document.dispatchEvent(new CustomEvent('drills-updated'));
}

// --- Internal Rendering Logic ---

function renderEditor() {
    const modalBody = document.getElementById('editor-body');
    modalBody.innerHTML = '';
    
    const isConnected = bleState.isConnected;

    tempDrillData.forEach((stepOptions, stepIndex) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'ball-group';
        groupDiv.innerHTML = `<div class="group-title">Ball ${stepIndex + 1}</div>`;

        stepOptions.forEach((ballParams, optIndex) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'option-card';
            
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
    if (paramIdx !== 3) val = parseInt(value); // Only Drop (idx 3) is float
    
    tempDrillData[stepIdx][optIdx][paramIdx] = val;
};

window.handleCloneBall = (stepIdx, optIdx) => {
    const ballConfig = [...tempDrillData[stepIdx][optIdx]];
    const newStep = [ballConfig]; 
    tempDrillData.splice(stepIdx + 1, 0, newStep);
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
    // Pack with default freq(50) and reps(1) for testing
    const ballData = packBall(d[0], d[1], d[2], d[3], 50, 1);
    
    try {
        await sendPacket([ballData]);
        showToast("Test Ball Fired");
    } catch (e) {
        console.error(e);
        showToast("Test Failed");
    }
};