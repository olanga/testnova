import { currentDrills, selectedLevel, runMode, appStats, setLastPlayed } from './state.js';
import { sendPacket, packBall, bleState } from './bluetooth.js';
import { log, showToast, clamp, toggleBodyScroll } from './utils.js';
import { updateStatsUI, updateLastPlayedHighlight } from './ui.js';

let isRunning = false;
let isPaused = false;
let isTestMode = false; // --- ADDED: Track Test Mode state
let currentCount = 0;
let targetCount = 0;
let remainingTime = 0;

// Timers
let pauseTimer = null;
let countdownTimer = null;
let runTimer = null;
let startTimeout = null; 

let activeDrillParams = null;
let activeDrillRandom = false;

// UI Elements (Cached for performance)
const ui = {
    overlay: document.getElementById('run-overlay'),
    testOverlay: document.getElementById('test-overlay'), // --- ADDED
    display: document.getElementById('run-display'),
    label: document.getElementById('run-label'),
    progress: document.getElementById('run-progress'),
    btnPause: document.getElementById('btn-pause')
};

// --- STANDARD DRILL START ---
export function startDrillSequence(drillName) {
    const rawParams = currentDrills[drillName] ? currentDrills[drillName][selectedLevel] : null;
    if(!rawParams) {
         log("Drill data not found: " + drillName);
         return;
    }

    // Filter Inactive Steps
    const executableSteps = rawParams.filter(step => {
        const isActive = step[0][6]; 
        return isActive === undefined || isActive === 1;
    });

    if (executableSteps.length === 0) {
        showToast("no active balls to play");
        document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
        return;
    }
    
    activeDrillParams = executableSteps;
    activeDrillRandom = !!currentDrills[drillName].random;
    isTestMode = false; // Ensure regular mode
    
    // Save state & Lock UI
    setLastPlayed(drillName);
    updateLastPlayedHighlight();
    toggleBodyScroll(true);
    ui.overlay.classList.add('open');
    
    // Countdown Logic
    let count = 4;
    ui.display.textContent = count;
    ui.label.textContent = "GET READY";
    ui.btnPause.style.display = 'none';
    
    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';
    void ui.progress.offsetWidth; 
    
    requestAnimationFrame(() => {
        ui.progress.style.transition = 'stroke-dashoffset 4s linear';
        ui.progress.style.strokeDashoffset = '565'; 
    });

    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            ui.display.textContent = count;
        } else {
            clearInterval(countdownTimer);
            ui.display.textContent = "GO!";
            startTimeout = setTimeout(beginDrillExecution, 800);
        }
    }, 1000);
}

// --- NEW: TEST DRILL START ---
export function startTestRun(drillSteps, isRandom) {
    // Filter Inactive Steps (Safety check)
    const executableSteps = drillSteps.filter(step => {
        const isActive = step[0][6]; 
        return isActive === undefined || isActive === 1;
    });

    if (executableSteps.length === 0) {
        showToast("No active balls to test");
        return;
    }

    activeDrillParams = executableSteps;
    activeDrillRandom = !!isRandom;
    isTestMode = true;
    isRunning = true;
    isPaused = false;

    toggleBodyScroll(true);
    if(ui.testOverlay) ui.testOverlay.classList.add('open');

    // Start immediately without countdown/stats
    runIteration();
}

export function beginDrillExecution() {
    isRunning = true;
    isPaused = false;
    
    // Increment Drill Count (Only in normal mode)
    if (!isTestMode) {
        appStats.drills += 1;
        localStorage.setItem('nova_stats', JSON.stringify(appStats));
        updateStatsUI();
    }

    ui.btnPause.style.display = 'block';
    ui.btnPause.textContent = "PAUSE";
    ui.btnPause.classList.remove('pulse-anim');
    ui.label.textContent = "REMAINING";

    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';

    if (runMode === 'time') {
        const tVal = document.getElementById('input-time').value;
        remainingTime = parseInt(tVal);
        ui.display.textContent = formatTime(remainingTime);
        
        requestAnimationFrame(() => {
             if(isRunning && !isPaused) {
                 ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
                 ui.progress.style.strokeDashoffset = '565';
             }
        });

        runTimer = setInterval(() => {
            if (!isPaused) {
                remainingTime--;
                ui.display.textContent = formatTime(remainingTime);
                if (remainingTime <= 0) stopRun();
            }
        }, 1000);
    } else {
        targetCount = parseInt(document.getElementById('input-reps').value) || 1;
        currentCount = 0;
        ui.display.textContent = targetCount;
        ui.progress.style.transition = 'stroke-dashoffset 0.5s ease';
    }
    
    runIteration();
}

async function runIteration() {
    if(!isRunning || isPaused) return;

    // Normal Mode UI Updates
    if (!isTestMode) {
        if (runMode === 'reps') {
            const remaining = targetCount - currentCount;
            ui.display.textContent = remaining;
            
            const fractionCompleted = currentCount / targetCount;
            ui.progress.style.strokeDashoffset = 565 * fractionCompleted;
            currentCount++;
        }
    }

    let sequence = activeDrillParams; 
    if (activeDrillRandom) {
        sequence = [...activeDrillParams]; 
        for (let i = sequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
        }
    }

    const balls = [];
    sequence.forEach((stepOptions, i) => {
        const chosenOption = stepOptions[Math.floor(Math.random() * stepOptions.length)];
        const tempBall = [...chosenOption];

        const scatter = tempBall[10] || 0;
        if (scatter > 0) {
            const currentDrop = tempBall[3];
            const minDrop = currentDrop - scatter;
            const maxDrop = currentDrop + scatter;
            const span = maxDrop - minDrop;
            const steps = Math.floor(span / 0.5);
            
            if (steps > 0) {
                const randomStep = Math.floor(Math.random() * (steps + 1));
                let newDrop = minDrop + (randomStep * 0.5);
                newDrop = clamp(newDrop, -10, 10);
                tempBall[3] = newDrop;
                log(`Scatter Active: Base ${currentDrop} ±${scatter} -> ${newDrop}`);
            }
        }

        balls.push(packBall(...tempBall));
    });

    // Only increment stats in Normal Mode
    if (!isTestMode) {
        appStats.balls += balls.length;
        localStorage.setItem('nova_stats', JSON.stringify(appStats));
        updateStatsUI();
    }

    const packet = buildPacket(balls);
    await sendPacket(packet);
}

// Callback from bluetooth.js when robot finishes
export function handleDone() {
    if(!isRunning) return;
    
    // Normal Mode Stop Condition
    if (!isTestMode && runMode === 'reps' && currentCount >= targetCount) {
        stopRun();
        return;
    }
    
    const pauseInput = parseFloat(document.getElementById('input-pause').value);
    const pauseMs = (isNaN(pauseInput) ? 1.0 : pauseInput) * 1000;

    // Pause logic applies to both Normal (Rep/Time) and Test (Infinite) modes
    if (!isPaused) {
         pauseTimer = setTimeout(() => { 
             if(isRunning && !isPaused) runIteration(); 
         }, pauseMs);
    }
}

export function togglePause() {
    if (isPaused) {
        isPaused = false;
        ui.btnPause.textContent = "PAUSE";
        ui.btnPause.classList.remove('pulse-anim');
        
        if(runMode === 'time' && !isTestMode) {
             ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
             ui.progress.style.strokeDashoffset = '565';
        }
        runIteration(); 
    } else {
        isPaused = true;
        ui.btnPause.textContent = "RESUME";
        ui.btnPause.classList.add('pulse-anim');
        clearTimeout(pauseTimer);
        
        if(!isTestMode) {
            const computedStyle = window.getComputedStyle(ui.progress);
            const currentOffset = computedStyle.getPropertyValue('stroke-dashoffset');
            ui.progress.style.transition = 'none';
            ui.progress.style.strokeDashoffset = currentOffset;
        }
        
        sendPacket([0x80,1,0,1]); 
    }
}

export function stopRun() {
    isRunning = false;
    isPaused = false;
    isTestMode = false; // Reset mode
    
    clearInterval(countdownTimer);
    clearInterval(runTimer);
    clearTimeout(pauseTimer);
    clearTimeout(startTimeout);
    
    toggleBodyScroll(false);
    
    // Close BOTH overlays
    ui.overlay.classList.remove('open');
    if(ui.testOverlay) ui.testOverlay.classList.remove('open');
    
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    
    sendPacket([0x80,1,0,1]); // Stop command
    log("Drill Stopped");
}

export function skipCountdown() {
    if (isRunning) return;
    if (!ui.overlay.classList.contains('open')) return;
    
    clearInterval(countdownTimer);
    clearTimeout(startTimeout);
    
    ui.display.textContent = "GO!";
    beginDrillExecution();
}

function formatTime(s) {
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

function buildPacket(balls) {
    const b = new ArrayBuffer(7 + balls.length*24);
    const v = new DataView(b);
    v.setUint8(0, 0x81); v.setUint16(1, 4+balls.length*24, true);
    v.setUint8(3, 1); v.setUint16(4, 1, true); v.setUint8(6, 0);
    const u = new Uint8Array(b);
    let off = 7;
    balls.forEach(ba => { u.set(ba, off); off+=24; });
    return u;
}