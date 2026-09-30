document.addEventListener('DOMContentLoaded', () => {
    // State
    const state = {
        isConnected: false,
        isSimulating: false,
        isAiSimulating: false,
        totalAlerts: 0,
        distribution: {} // type: count
    };

    // UI Elements
    const els = {
        indicator: document.getElementById('connection-status'),
        btnToggleSim: document.getElementById('toggle-sim-btn'),
        btnKillSwitch: document.getElementById('kill-switch-btn'),
        sliderInterval: document.getElementById('interval-slider'),
        valInterval: document.getElementById('interval-val'),
        sliderMetric: document.getElementById('metric-slider'),
        valMetric: document.getElementById('metric-val'),
        statTotal: document.getElementById('stat-total'),
        statSim: document.getElementById('stat-sim'),
        alertsBody: document.getElementById('alerts-body'),
        formGenerate: document.getElementById('generate-form'),
        chkScroll: document.getElementById('auto-scroll'),
        tableWrapper: document.querySelector('.table-wrapper'),
        // AI elements
        btnAiGenerate: document.getElementById('btn-ai-generate'),
        btnAiStream: document.getElementById('btn-ai-stream'),
        inputAiPrompt: document.getElementById('ai-prompt'),
        aiSpinner: document.getElementById('ai-spinner')
    };

    // Chart.js init
    const ctx = document.getElementById('distributionChart').getContext('2d');
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(249, 115, 22, 0.8)',
                    'rgba(168, 85, 247, 0.8)',
                    'rgba(236, 72, 153, 0.8)',
                    'rgba(234, 179, 8, 0.8)'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#e2e8f0', boxWidth: 12 } }
            }
        }
    });

    // WebSocket logic
    let ws;
    function connectWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = () => {
            state.isConnected = true;
            els.indicator.classList.add('connected');
        };

        ws.onclose = () => {
            state.isConnected = false;
            els.indicator.classList.remove('connected');
            setTimeout(connectWS, 3000); // Reconnect
        };

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'new_alert') {
                handleNewAlert(msg.data);
            } else if (msg.type === 'kill_switch_update') {
                updateKillSwitchUI(msg.data.status);
            }
        };
    }

    // Initial API load for status
    async function loadStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            state.isSimulating = data.simulating;
            state.isAiSimulating = data.ai_simulating;
            updateSimButtonUI();
            updateAiStreamUI();
            
            els.sliderInterval.value = data.interval;
            els.valInterval.innerText = data.interval;
            
            updateKillSwitchUI(data.kill_switch);
        } catch (e) {
            console.error("Error loading status:", e);
        }
    }

    // Handlers
    function handleNewAlert(alert) {
        state.totalAlerts++;
        els.statTotal.innerText = state.totalAlerts;

        // Update distribution
        state.distribution[alert.alert_type] = (state.distribution[alert.alert_type] || 0) + 1;
        updateChart();

        // Add to table
        const tr = document.createElement('tr');
        tr.classList.add('new-row');
        
        const time = new Date(alert.timestamp).toLocaleTimeString();
        const source = alert.enrichment?.source || 'direct';
        const sourceBadge = `<span class="source-tag source-${source}">${source}</span>`;

        tr.innerHTML = `
            <td>${time}</td>
            <td><span class="badge ${alert.severity}">${alert.severity}</span></td>
            <td>${alert.alert_type.replace('_', ' ')}</td>
            <td>${alert.service}</td>
            <td>${sourceBadge}</td>
        `;
        
        els.alertsBody.prepend(tr);
        
        // Keep table reasonable length (max 100 rows)
        if (els.alertsBody.children.length > 100) {
            els.alertsBody.lastElementChild.remove();
        }

        // Auto-scroll logic 
        if (els.chkScroll.checked) {
            els.tableWrapper.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function updateChart() {
        // Sort and get top 7
        const sorted = Object.entries(state.distribution)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 7);
            
        chart.data.labels = sorted.map(i => i[0].replace('_', ' '));
        chart.data.datasets[0].data = sorted.map(i => i[1]);
        chart.update();
    }

    function updateSimButtonUI() {
        if (state.isSimulating) {
            els.btnToggleSim.innerText = "Stop Simulation";
            els.btnToggleSim.classList.replace('btn-primary', 'btn-secondary');
            els.statSim.innerText = "Running";
            els.statSim.style.color = "var(--sev-info)";
        } else {
            els.btnToggleSim.innerText = "Start Simulation";
            els.btnToggleSim.classList.replace('btn-secondary', 'btn-primary');
            els.statSim.innerText = "Stopped";
            els.statSim.style.color = "var(--text-muted)";
        }
    }

    function updateAiStreamUI() {
        console.log("Updating AI Stream UI, active:", state.isAiSimulating);
        if (state.isAiSimulating) {
            els.btnAiStream.innerText = "Disable AI Stream";
            els.btnAiStream.classList.remove('btn-secondary');
            els.btnAiStream.classList.add('active');
        } else {
            els.btnAiStream.innerText = "Enable AI Stream";
            els.btnAiStream.classList.remove('active');
            els.btnAiStream.classList.add('btn-secondary');
        }
    }
    
    function updateKillSwitchUI(isActive) {
        if (isActive) {
            els.btnKillSwitch.classList.add('active');
            els.btnKillSwitch.innerText = "KILL SWITCH ACIIVE";
        } else {
            els.btnKillSwitch.classList.remove('active');
            els.btnKillSwitch.innerText = "KILL SWITCH O/I";
        }
    }

    // Event Listeners
    els.sliderInterval.addEventListener('input', (e) => {
        els.valInterval.innerText = e.target.value;
    });

    els.sliderMetric.addEventListener('input', (e) => {
        els.valMetric.innerText = e.target.value;
    });

    els.btnToggleSim.addEventListener('click', async () => {
        const endpoint = state.isSimulating ? '/api/simulation/stop' : '/api/simulation/start';
        const payload = state.isSimulating ? null : JSON.stringify({ interval: parseInt(els.sliderInterval.value) });
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: payload
            });
            const data = await res.json();
            state.isSimulating = (data.status === 'started');
            updateSimButtonUI();
        } catch (e) {
            console.error("Simulation toggle failed:", e);
        }
    });

    els.btnKillSwitch.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/kill-switch', { method: 'POST' });
            const data = await res.json();
            updateKillSwitchUI(data.status);
        } catch(e) {
            console.error("Kill switch toggle failed:", e);
        }
    });

    els.formGenerate.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload = {
            type: document.getElementById('alert-type').value,
            severity: document.getElementById('alert-severity').value,
            service: document.getElementById('alert-service').value,
            metrics: {
                source: document.getElementById('alert-source').value,
                multiplier: parseInt(els.sliderMetric.value) / 100
            }
        };
        
        try {
            await fetch('/api/alerts', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            // We do not manually add row since WS will beam it back
        } catch(e) {
            console.error("Submit failed", e);
        }
    });

    els.btnAiGenerate.addEventListener('click', async () => {
        const prompt = els.inputAiPrompt.value;
        const source = document.getElementById('ai-source').value;
        
        // UI Feedback
        els.btnAiGenerate.disabled = true;
        els.aiSpinner.style.display = 'inline-block';
        
        try {
            const res = await fetch('/api/alerts/generate-ai', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ prompt, source })
            });
            
            if (res.ok) {
                els.inputAiPrompt.value = ''; // clear on success
            }
        } catch (e) {
            console.error("AI Generation failed:", e);
        } finally {
            els.btnAiGenerate.disabled = false;
            els.aiSpinner.style.display = 'none';
        }
    });

    els.btnAiStream.addEventListener('click', async () => {
        console.log("AI Stream button clicked");
        const endpoint = state.isAiSimulating ? '/api/simulation/ai/stop' : '/api/simulation/ai/start';
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ interval: 10 })
            });
            const data = await res.json();
            console.log("AI Stream toggle response:", data);
            state.isAiSimulating = (data.status === 'started');
            updateAiStreamUI();
        } catch (e) {
            console.error("AI Stream toggle failed:", e);
        }
    });

    // Boot
    connectWS();
    loadStatus();
});
