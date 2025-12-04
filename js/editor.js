import { currentDrills, selectedLevel, saveDrillsToStorage } from './state.js';
import { RANGE_CONFIG } from './constants.js';
import { sendPacket, packBall } from './bluetooth.js';
import { showToast, clamp } from './utils.js';
import { state } from './main.js';

// --- Local State ---
let tempDrillData = null;
let editingDrillKey = null;

// --- Public Module Functions ---

/**
 * Opens the editor modal for a specific drill key.
 * Creates a deep copy of the drill data so changes aren't applied until "Save".
 */
export function openEditor(key) {
    editingDrillKey = key;
    
    // Set Random Checkbox state
    const chk = document.getElementById('chk-drill-random');
    if (chk) chk.checked = !!currentDrills[key].random;

    // Deep copy current level data: [ [Step1_Opt1, ...], [Step2_Opt1] ]
    // We use JSON parse/stringify for a cheap deep clone of the array structure
    if (currentDrills[key] && currentDrills[key][selectedLevel]) {
        tempDrillData = JSON.parse(JSON.stringify(currentDrills[key][selectedLevel]));
    } else {
        // Fallback if data is missing
        tempDrillData = [[[1500, 3000, 50, 0, 50, 1]]];
    }

    renderEditor();
    document.getElementById('editor-modal').classList.add('open');
}

/**
 * Closes the editor and clears temp state.
 */
export function closeEditor() {
    document.getElementById('editor-modal').classList.remove('open');
    editingDrillKey = null;
    tempDrillData = null;
}

/**
 * Validates, clamps, and persists the temp data to the main state.
 */
export function saveDrillChanges() {
    if (!editingDrillKey || !tempDrillData) return;

    // 1. Update Random Setting
    const chk = document.getElementById('chk-drill-random');
    if (chk) currentDrills[editingDrillKey].random = chk.checked;

    // 2. Sanitize Data (Clamp all values to safe ranges)
    tempDrillData.forEach(step => {
        step.forEach(ball => {
            ball[0] = clamp(ball[0], 400, 7500); // Top Motor
            ball[1] = clamp(ball[1], 400, 7500); // Bottom Motor
            ball[2] = clamp(ball[2], -50, 100);  // Height
            ball[3] = clamp(ball[3], -10, 10);   // Drop
            ball[4] = clamp(ball[4], 0, 100);    // Frequency
            ball[5] = clamp(ball[5], 1, 200);    // Reps
        });
    });

    // 3. Save to State
    currentDrills[editingDrillKey][selectedLevel] = tempDrillData;
    saveDrillsToStorage();

    // 4. Update UI
    closeEditor();
    showToast(`Saved Level ${selectedLevel}`);
    
    // Notify main.js to re-render buttons (e.g., to show/hide "R" mark)
    document.dispatchEvent(new CustomEvent('drills-updated'));
}

// --- Internal Rendering Logic ---

function renderEditor() {
    const modalBody = document.getElementById('editor-body');
    modalBody.innerHTML = '';
    
    const isConnected = state.connection === 'ready';

    tempDrillData.forEach((stepOptions, stepIndex) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'ball-group';
        
        // Dynamic Numbering: stepIndex guarantees sequential numbering (Ball 1, Ball 2...)
        // regardless of deletions happening before this index.
        groupDiv.innerHTML = `<div class="group-title">Ball ${stepIndex + 1}</div>`;

        stepOptions.forEach((ballParams, optIndex) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'option-card';
            
            // Render Input Fields
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

            // Determine if Delete should be disabled
            // Rule: Cannot delete if it is the only ball remaining in the entire drill
            const isLastBall = tempDrillData.length === 1 && stepOptions.length === 1;

            // Action Buttons
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

            // If there are multiple options for one ball (Randomized step), show label
            const label = stepOptions.length > 1 ? `<span class="option-label">Option ${optIndex + 1}</span>` : '';

            optDiv.innerHTML = label + gridHtml + actionsHtml;
            groupDiv.appendChild(optDiv);
        });

        modalBody.appendChild(groupDiv);
    });
}

// --- Window Global Handlers ---
// These are attached to window so the HTML string generated in renderEditor can call them.

window.handleEditorInput = (stepIdx, optIdx, paramIdx, value) => {
    if (!tempDrillData) return;
    
    let val = parseFloat(value);
    if (isNaN(val)) return;

    // Only Drop (paramIdx 3) allows decimals. Others are integers.
    if (paramIdx !== 3) {
        val = parseInt(value);
    }
    
    // Update array directly. No re-render needed for input changes (performance).
    tempDrillData[stepIdx][optIdx][paramIdx] = val;
};

window.handleCloneBall = (stepIdx, optIdx) => {
    // Copy the specific ball configuration
    const ballConfig = [...tempDrillData[stepIdx][optIdx]];
    
    // Insert a NEW Step (Ball) containing this configuration immediately after current step
    const newStep = [ballConfig]; 
    tempDrillData.splice(stepIdx + 1, 0, newStep);
    
    renderEditor();
    // Optional: scroll to the new ball could be added here
};

window.handleDeleteBall = (stepIdx, optIdx) => {
    // Safety check: Prevent deleting the very last ball
    if (tempDrillData.length <= 1 && tempDrillData[0].length <= 1) {
        showToast("Cannot delete the last ball");
        return;
    }

    // 1. Remove the specific option from the step
    tempDrillData[stepIdx].splice(optIdx, 1);

    // 2. If the Step is now empty (no options left), remove the Step entirely
    if (tempDrillData[stepIdx].length === 0) {
        tempDrillData.splice(stepIdx, 1);
    }

    renderEditor();
};

window.handleTestBall = async (stepIdx, optIdx) => {
    if (state.connection !== 'ready') {
        showToast("Device not connected");
        return;
    }
    
    const d = tempDrillData[stepIdx][optIdx];
    
    // Pack data: Top, Bot, Hgt, Drop, Default Freq (50), Default Reps (1)
    const ballData = packBall(d[0], d[1], d[2], d[3], 50, 1);
    
    try {
        await sendPacket([ballData]);
        showToast("Test Ball Fired");
    } catch (e) {
        console.error(e);
        showToast("Test Failed");
    }
};