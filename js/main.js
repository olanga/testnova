import { 
    initData, 
    setLevel, 
    setMode, 
    resetStats, 
    importCustomDrills, 
    exportCustomDrills, 
    saveAsDefault, 
    resetToDefault, 
    factoryReset,
    appStats,
    userCustomDrills,
    currentDrills,
    saveDrillsToStorage,
    selectedLevel 
} from './state.js';

import { 
    connectDevice, 
    disconnectDevice, 
    bleState 
} from './bluetooth.js';

import { 
    openEditor, 
    closeEditor, 
    saveDrillChanges 
} from './editor.js';

import { 
    renderDrillButtons, 
    updateDrillButtonStates, 
    setTheme, 
    toggleMenu, 
    switchTab, 
    updateStatsUI
} from './ui.js';

import { showToast } from './utils.js';

import { 
    startDrillSequence, 
    stopRun, 
    togglePause 
} from './runner.js';

import { downloadDrill } from './cloud.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    initData();
    renderDrillButtons();
    updateStatsUI();
    setupEventListeners();
    console.log("Nova Drill Control: Modules Loaded");
});

// --- Event Listeners Setup ---

function setupEventListeners() {
    const btnConnect = document.getElementById('btn-connect');
    if (btnConnect) {
        btnConnect.onclick = () => {
            if (bleState.isConnected) disconnectDevice();
            else connectDevice();
        };
    }

    const inputPause = document.getElementById('input-pause');
    if (inputPause) {
        inputPause.onchange = (e) => {
            // Change parseInt to parseFloat
            let val = parseFloat(e.target.value);
            
            // Update limits: 500ms -> 0.5s, 5000ms -> 5.0s
            if(val < 0.5) val = 0.5;
            if(val > 5.0) val = 5.0;
            
            // Format to 1 decimal place
            e.target.value = val.toFixed(1);
        };
    }

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('theme-menu');
        if (menu && menu.classList.contains('open') && 
            !menu.contains(e.target) && 
            !e.target.closest('.menu-btn')) {
            menu.classList.remove('open');
        }
    });

    document.addEventListener('drills-updated', () => {
        renderDrillButtons();
        updateDrillButtonStates();
    });
    
    document.addEventListener('connection-changed', () => {
        updateDrillButtonStates();
        const editorModal = document.getElementById('editor-modal');
        if(editorModal && editorModal.classList.contains('open')) {
            const testBtns = document.querySelectorAll('.btn-act-test');
            testBtns.forEach(b => b.disabled = !bleState.isConnected);
        }
    });
}

// --- Window Binding for HTML Compatibility ---

window.toggleMenu = toggleMenu;
window.setTheme = setTheme;
window.switchTab = switchTab;

window.setLevel = (lvl, btn) => {
    setLevel(lvl);
    document.querySelectorAll('.lvl-dot').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
};

window.setMode = (mode, btn) => {
    setMode(mode);
    document.querySelectorAll('.mode-option').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
    
    const uiReps = document.getElementById('ui-reps');
    const uiTime = document.getElementById('ui-time');
    if(mode === 'reps') {
        uiReps?.classList.remove('hidden');
        uiTime?.classList.add('hidden');
    } else {
        uiReps?.classList.add('hidden');
        uiTime?.classList.remove('hidden');
    }
};

window.resetStats = resetStats;
window.saveAsDefault = saveAsDefault;
window.resetToDefault = resetToDefault;
window.factoryReset = factoryReset;
window.exportCustomDrills = exportCustomDrills;

window.handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) { 
        const success = importCustomDrills(e.target.result);
        if(success) {
            renderDrillButtons();
            toggleMenu(); 
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.saveDrillChanges = saveDrillChanges;
window.togglePause = togglePause;
window.stopRun = stopRun;

window.handleDrillClick = (key, btn) => {
    if (!bleState.isConnected) {
        showToast("Device not connected");
        return;
    }
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    btn.classList.add('running');
    startDrillSequence(key);
};

// --- DOWNLOAD HANDLER (FIXED) ---
window.handleDownloadDialog = async () => {
    const code = prompt("Enter Share Code (e.g. ABC123):");
    if (!code || code.trim().length !== 6) {
        if(code) showToast("Invalid code format");
        return;
    }

    showToast("Searching...");

    try {
        const data = await downloadDrill(code);
        if (!data) {
            showToast("Code not found or expired");
            return;
        }

        let name = data.name;
        // Check for duplicates purely for visual naming (append Imp)
        const allNames = [
            ...userCustomDrills['custom-a'], 
            ...userCustomDrills['custom-b'], 
            ...userCustomDrills['custom-c']
        ].map(d => d.name);

        if (allNames.includes(name)) {
            name = `${name} (Imp)`;
        }

        let targetCat = 'custom-a';
        if (userCustomDrills['custom-a'].length >= 20) {
            if (userCustomDrills['custom-b'].length < 20) targetCat = 'custom-b';
            else if (userCustomDrills['custom-c'].length < 20) targetCat = 'custom-c';
            else { showToast("All custom banks full!"); return; }
        }

        const catChar = targetCat.split('-')[1].toUpperCase();
        
        // --- FIX: Append Timestamp to ensure Key is ALWAYS Unique ---
        const newKey = `cust_${catChar}_${name.replace(/\s+/g, '_')}_${Date.now()}`;

        userCustomDrills[targetCat].push({ name: name, key: newKey });
        
        const newDrillObj = { 1: [], 2: [], 3: [], random: data.random };
        newDrillObj[selectedLevel] = data.params; 

        currentDrills[newKey] = newDrillObj;

        localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
        saveDrillsToStorage();

        renderDrillButtons();
        showToast(`Imported to Custom ${catChar}`);
        toggleMenu(); 

    } catch (e) {
        console.error(e);
        showToast("Download Error");
    }
};