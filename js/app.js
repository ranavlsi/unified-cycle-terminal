document.addEventListener('DOMContentLoaded', () => {
    // 1. Tab Switching Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active classes
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            // Activate target
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            // Trigger redraw for SVG scaling if we have active data
            if (activeHistoryData) {
                // Determine engine types for the newly active pane
                const targetPane = document.getElementById(targetId);
                const containers = targetPane.querySelectorAll('.chart-container');
                containers.forEach(container => {
                    const engineType = container.getAttribute('data-engine') || 'legacy';
                    drawDynamicChart(container.id || 'legacy-chart', activeHistoryData, engineType);
                });
            }
        });
    });

    // 2. Double-Click & Zoom Button Setup for Fullscreen
    const chartContainers = document.querySelectorAll('.chart-container');
    const expandBtns = document.querySelectorAll('.btn-expand');
    const modal = document.getElementById('expanded-modal');
    const modalClose = document.getElementById('close-modal');
    const modalContentArea = document.getElementById('modal-chart-content');
    const modalTitle = document.getElementById('modal-title');

    // Global Data State for Modal Re-Drawing
    let activeTickerStr = '';
    let activeHistoryData = null;
    let zoomDomain = null; // [startIndex, endIndex]
    let liveDataInterval = null;

    // Reusable function to open modal
    const openChartModal = (container) => {
        if (!activeHistoryData) {
            alert("Please search a ticker first to analyze.");
            return;
        }

        const engineType = container.getAttribute('data-engine') || 'PATTERN';
        
        // Deep clone the entire container holding the SVG and axes
        const activeChartNode = container.cloneNode(true);
        activeChartNode.style.padding = '10px 55px 30px 10px'; // Keep axes padding
        
        // Find the title from the parent panel
        const panel = container.closest('.engine-panel');
        const titleEl = panel.querySelector('.panel-title');
        const modalHeading = titleEl ? titleEl.textContent : `${engineType.toUpperCase()} ENGINE [FULL SCREEN]`;
        
        modalTitle.textContent = modalHeading;
        modalContentArea.innerHTML = '';
        activeChartNode.id = 'modal-expanded-chart';
        modalContentArea.appendChild(activeChartNode);
        modal.classList.add('active');

        // Redraw to scale dynamically upon zoom if history exists
        if (activeHistoryData) {
            setTimeout(() => {
                let currentHistory = activeHistoryData;
                if (zoomDomain) {
                    currentHistory = activeHistoryData.slice(zoomDomain[0], zoomDomain[1] + 1);
                }

                // Let flexbox compute the new space, then draw
                drawDynamicChart('modal-expanded-chart', currentHistory, engineType);
                
                // Keep the target updated for elliott zoom
                if (engineType === 'elliott') {
                    const prices = currentHistory.map(d => d.price);
                    const w5y = Math.max(...prices) * 1.05;
                    const clonedTargetPrice = document.querySelector('#modal-expanded-chart #elliott-target-price');
                    if (clonedTargetPrice) clonedTargetPrice.textContent = `$${(w5y*0.98).toFixed(2)} - $${(w5y*1.05).toFixed(2)}`;
                }

                if (engineType === 'legacy') {
                    const updatedPatTitle = document.querySelector('#modal-expanded-chart #pattern-title-text-svg');
                    if (updatedPatTitle) {
                        const rawText = updatedPatTitle.getAttribute('data-raw-text') || 'PATTERN DETECTED';
                        updatedPatTitle.textContent = `${activeTickerStr} ${rawText}`;
                    }
                }
                
                // Keep X Axes Synced in Modal
                const modalWrapper = document.getElementById('modal-expanded-chart');
                if (modalWrapper) {
                     const yTicksX = modalWrapper.querySelector('.chart-x-axis');
                     if(yTicksX) {
                          const xTicks = [];
                          for (let i = 0; i < 5; i++) {
                              const idx = Math.floor(i * (currentHistory.length - 1) / 4);
                              let t = currentHistory[idx].time;
                              if (t < 10000000000) t *= 1000;
                              const d = new Date(t);
                              xTicks.push(d.toLocaleDateString(undefined, {year: '2-digit', month: 'short'}));
                          }
                          yTicksX.innerHTML = xTicks.map(val => `<div class="axis-tick">${val}</div>`).join('');
                     }
                }

            }, 100); // Allow browser paint cycle to determine new active class flexbox width/height
        }
    };

    chartContainers.forEach(container => {
        container.addEventListener('dblclick', () => openChartModal(container));
    });

    expandBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.closest('.engine-panel');
            if (panel) {
                const container = panel.querySelector('.chart-container');
                if (container) openChartModal(container);
            }
        });
    });

    // Close modal handlers
    modalClose.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });

    // 3. Live Data API Fetch (Yahoo Finance / Google News Simulation)
    const searchInput = document.getElementById('tickerSearch');
    const searchBtn = document.getElementById('btnSearch');
    const liveTickerTrack = document.getElementById('live-ticker-track');
    const newsFeed = document.getElementById('news-feed');

    const fetchStockData = async (ticker) => {
        try {
            // Using local Python proxy to bypass CORS
            const proxyUrl = `http://localhost:8000/api/stock?ticker=${ticker}`;
            
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error('Proxy API Error');
            const data = await res.json();
            
            const meta = data.chart.result[0].meta;
            const currentPrice = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose;
            const change = currentPrice - prevClose;
            
            const timestamps = data.chart.result[0].timestamp;
            const closes = data.chart.result[0].indicators.quote[0].close;
            
            // Filter out nulls
            const validData = [];
            for (let i = 0; i < closes.length; i++) {
                if (closes[i] !== null) {
                    validData.push({ time: timestamps[i], price: closes[i] });
                }
            }

            return { 
                price: currentPrice.toFixed(2), 
                change, 
                changePercent: (change/prevClose*100).toFixed(2),
                history: validData // Return the array for drawing
            };
        } catch (e) {
            console.error("Live API proxy failed:", e);
            
            // Fallback deterministic logic so the UI doesn't crash completely.
            let seed = 0;
            for (let i = 0; i < ticker.length; i++) seed += ticker.charCodeAt(i);
            const p = (seed * 1.5) % 500 + 10; 
            const c = (seed % 10) - 5;
            
            // Mock a 10-year array (2520 trading days roughly)
            const mockHistory = [];
            const now = Date.now();
            let mockP = p * 0.5;
            for(let i=0; i<2520; i++) {
                mockP += (Math.random() - 0.48) * (p * 0.02);
                mockHistory.push({ time: now - (2520-i)*86400000, price: mockP });
            }

            return { price: p.toFixed(2), change: c, changePercent: (c/p*100).toFixed(2), error: true, history: mockHistory };
        }
    };

    const fetchGoogleNews = async (ticker) => {
        try {
            const proxyUrl = `http://localhost:8000/api/news?ticker=${ticker}`;
            
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error('News proxy error');
            const xmlText = await res.text();
            if(!xmlText) throw new Error("Empty XML");

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const items = xmlDoc.querySelectorAll("item");
            
            let newsHtml = '';
            for(let i=0; i < Math.min(3, items.length); i++) {
                const title = items[i].querySelector("title").textContent;
                const link = items[i].querySelector("link").textContent;
                const pubDate = items[i].querySelector("pubDate").textContent;
                // Clean date
                const dateClean = new Date(pubDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
                
                newsHtml += `
                    <div class="news-item">
                        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:5px;">${dateClean} | <a href="${link}" target="_blank" style="color:var(--neon-cyan); text-decoration:none;">Read Source ↗</a></div>
                        <strong>${title}</strong>
                    </div>
                `;
            }
            if(!newsHtml) newsHtml = `<div class="news-item">No recent news found for <span class="neon-cyan">${ticker}</span>.</div>`;
            return newsHtml;
        } catch (e) {
            return `<div class="news-item" style="color:var(--neon-red);">Failed to load live news feed. Is proxy.py running?</div>`;
        }
    };

    const fetchFundamentalData = async (ticker) => {
        try {
            const proxyUrl = `http://localhost:8000/api/fundamentals?ticker=${ticker}`;
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error('Fundamentals proxy error');
            const data = await res.json();
            // Validate the response has the expected shape before returning
            if (data && data.quoteSummary && !data.quoteSummary.error) {
                return data;
            }
            return null;
        } catch (e) {
            console.warn('Fundamental data fetch failed, using simulation fallback:', e);
            return null;
        }
    };

    const renderChartAxes = (ticker, price, history) => {
        const p = parseFloat(price);
        if (isNaN(p)) return;
        
        // Generate pseudo Y axis ticks centered around price
        const yTicks = [
            (p * 1.08).toFixed(2),
            (p * 1.04).toFixed(2),
            p.toFixed(2),
            (p * 0.96).toFixed(2),
            (p * 0.92).toFixed(2)
        ];
        
        let xTicks = [];
        if (history && history.length > 0) {
            for (let i = 0; i < 5; i++) {
                const idx = Math.floor(i * (history.length - 1) / 4);
                let t = history[idx].time;
                if (t < 10000000000) t *= 1000; // API returns seconds, mock uses ms
                const d = new Date(t);
                xTicks.push(d.toLocaleDateString(undefined, {year: '2-digit', month: 'short'}));
            }
        } else {
            // Generate pseudo X axis ticks based on current time
            const now = new Date();
            for (let i = 4; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 60 * 60 * 1000); // Past hours
                xTicks.push(d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
            }
        }
        
        document.querySelectorAll('.chart-y-axis').forEach(axis => {
            axis.innerHTML = yTicks.map((val, idx) => 
                `<div class="axis-tick ${idx === 2 ? 'highlight' : ''}">${val}</div>`
            ).join('');
        });
        
        document.querySelectorAll('.chart-x-axis').forEach(axis => {
            axis.innerHTML = xTicks.map(val => 
                `<div class="axis-tick">${val}</div>`
            ).join('');
        });
    };

    const recognizePattern = (history) => {
        if (!history || history.length < 20) {
            return { type: 'channel', text: 'TREND CHANNEL', desc: 'Consolidation phase detected' };
        }
        
        const prices = history.map(d => d.price);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        const range = maxP - minP;

        // Peak/trough detection
        const peaks = [];
        const troughs = [];
        const windowSize = 5;
        
        for (let i = windowSize; i < prices.length - windowSize; i++) {
            let isPeak = true;
            let isTrough = true;
            for (let j = i - windowSize; j <= i + windowSize; j++) {
                if (prices[j] > prices[i]) isPeak = false;
                if (prices[j] < prices[i]) isTrough = false;
            }
            if (isPeak) peaks.push({ index: i, price: prices[i] });
            if (isTrough) troughs.push({ index: i, price: prices[i] });
        }

        const recentPeaks = peaks.filter(p => p.index > prices.length - 100);
        const recentTroughs = troughs.filter(t => t.index > prices.length - 100);

        if (recentPeaks.length >= 3) {
            const p1 = recentPeaks[recentPeaks.length - 3];
            const p2 = recentPeaks[recentPeaks.length - 2];
            const p3 = recentPeaks[recentPeaks.length - 1];
            
            if (p2.price > p1.price && p2.price > p3.price && Math.abs(p1.price - p3.price) < range * 0.1) {
                return { type: 'head_shoulders', text: 'HEAD & SHOULDERS', desc: 'Neckline Breakdown Expected' };
            }
        }

        if (recentPeaks.length >= 2) {
            const p1 = recentPeaks[recentPeaks.length - 2];
            const p2 = recentPeaks[recentPeaks.length - 1];
            if (Math.abs(p1.price - p2.price) < range * 0.05 && (maxP - p1.price) < range * 0.2) {
                return { type: 'double_top', text: 'DOUBLE TOP', desc: 'Resistance Rejection Detected', resistance: (p1.price + p2.price) / 2 };
            }
        }

        if (recentTroughs.length >= 2) {
            const t1 = recentTroughs[recentTroughs.length - 2];
            const t2 = recentTroughs[recentTroughs.length - 1];
            if (Math.abs(t1.price - t2.price) < range * 0.05 && (t1.price - minP) < range * 0.2) {
                return { type: 'double_bottom', text: 'DOUBLE BOTTOM', desc: 'Support Base Found', support: (t1.price + t2.price) / 2 };
            }
        }

        if (recentPeaks.length >= 2 && recentTroughs.length >= 2) {
             const p1 = recentPeaks[recentPeaks.length - 2];
             const p2 = recentPeaks[recentPeaks.length - 1];
             const t1 = recentTroughs[recentTroughs.length - 2];
             const t2 = recentTroughs[recentTroughs.length - 1];
             
             if (Math.abs(p1.price - p2.price) < range * 0.05 && t2.price > t1.price) {
                  return { type: 'ascending_triangle', text: 'ASCENDING TRIANGLE', desc: 'Bullish Continuation Setup', resistance: (p1.price + p2.price) / 2, supportStart: t1, supportEnd: t2 };
             }
        }

        return { type: 'channel', text: 'TREND CHANNEL', desc: 'Consolidation Phase', res: maxP - range * 0.1, sup: minP + range * 0.1 };
    };

    const drawDynamicChart = (containerId, history, engineType) => {
        const svg = document.querySelector(`#${containerId} svg`);
        if (!svg || !history || history.length === 0) return;

        // Clear existing SVG paths/labels
        svg.innerHTML = '';

        const width = svg.clientWidth || 500;
        const height = svg.clientHeight || 250;
        const padding = 20;

        const prices = history.map(d => d.price);
        const minPrice = Math.min(...prices) * 0.95; // 5% buffer bottom
        const maxPrice = Math.max(...prices) * 1.05; // 5% buffer top
        
        // Math scalers
        const scaleX = (idx) => padding + (idx / (history.length - 1)) * (width - padding * 2);
        const scaleY = (val) => height - padding - ((val - minPrice) / (maxPrice - minPrice)) * (height - padding * 2);

        // 1. Draw standard historical price line
        let pathD = `M ${scaleX(0)},${scaleY(prices[0])}`;
        for (let i = 1; i < prices.length; i++) {
            pathD += ` L ${scaleX(i)},${scaleY(prices[i])}`;
        }
        
        const pricePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pricePath.setAttribute('d', pathD);
        pricePath.setAttribute('fill', 'none');

        // Style based on engine
        if (engineType === 'gann') {
            pricePath.setAttribute('class', 'gann-price');
            pricePath.setAttribute('stroke', 'var(--text-main)');
            pricePath.setAttribute('stroke-width', '2');
            
            // Find absolute low in the visible history to anchor the fan
            let anchorIdx = 0;
            let anchorVal = prices[0];
            for (let i = 1; i < prices.length; i++) {
                if (prices[i] < anchorVal) { anchorVal = prices[i]; anchorIdx = i; }
            }
            
            // Gann Vectors: Overlay simple fans from the lowest point to top right
            const fanAngles = [0.25, 0.5, 1, 2, 4];
            const fanLabels = ['8x1', '4x1', '2x1', '1x1', '1x2'];
            
            const startX = scaleX(anchorIdx);
            const startY = scaleY(anchorVal);
            
            fanAngles.forEach((ratio, idx) => {
                const f = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                f.setAttribute('x1', startX);
                f.setAttribute('y1', startY);
                // Extend out based on ratio, limiting to chart boundaries
                const endX = width;
                const endY = startY - ((width - startX) * ratio * ((maxPrice - minPrice) / width) * 2); 
                // Fallback math if angles go wild
                const safeEndY = Math.max(0, Math.min(height, endY));

                f.setAttribute('x2', endX);
                f.setAttribute('y2', safeEndY);
                f.setAttribute('class', 'gann-fan');
                f.setAttribute('stroke', 'var(--neon-cyan)');
                svg.appendChild(f);
                
                // Add labels mapped to the fan line extremity
                const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.setAttribute('x', endX - 25);
                txt.setAttribute('y', safeEndY > 10 ? safeEndY - 5 : 15);
                txt.setAttribute('fill', 'var(--neon-cyan)');
                txt.setAttribute('font-size', '0.65rem');
                txt.textContent = fanLabels[idx];
                svg.appendChild(txt);
            });

            // Re-add squaring dot and Square of Nine Box mapped to a recent high
            let highIdx = anchorIdx;
            let highVal = anchorVal;
            for (let i = anchorIdx; i < prices.length; i++) {
                if (prices[i] > highVal) { highVal = prices[i]; highIdx = i; }
            }
            
            const cx = scaleX(highIdx);
            const cy = scaleY(highVal);
            const boxW = width * 0.2;
            const boxH = height * 0.3;
            
            const sqBoxHtml = `
                <rect x="${cx - boxW/2}" y="${cy - boxH/2}" width="${boxW}" height="${boxH}" fill="rgba(0,255,0,0.05)" stroke="var(--neon-green)" stroke-width="1" stroke-dasharray="2,2"/>
                <circle cx="${cx}" cy="${cy}" r="10" class="gann-intersection pulse" />
                <text x="${cx}" y="${cy - boxH/2 - 10}" fill="var(--neon-green)" font-size="0.7rem" text-anchor="middle">Time/Price Squared</text>
            `;
            svg.innerHTML += sqBoxHtml;
            svg.appendChild(pricePath);

        } else if (engineType === 'hurst') {
            pricePath.setAttribute('class', 'price-line');
            
            // Calculate a simple Moving Average for Envelopes
            const ma = [];
            const period = Math.max(5, Math.floor(prices.length * 0.1));
            for (let i = 0; i < prices.length; i++) {
                if (i < period) {
                    ma.push(prices[i]);
                } else {
                    let sum = 0;
                    for (let j = i - period; j < i; j++) sum += prices[j];
                    ma.push(sum / period);
                }
            }

            // Draw Hurst Envelopes mapping volatility/range
            const envOffset = (maxPrice - minPrice) * 0.15; 
            
            let envUpD = `M ${scaleX(0)},${scaleY(ma[0] + envOffset)}`;
            let envDnD = `M ${scaleX(0)},${scaleY(ma[0] - envOffset)}`;
            
            for (let i = 1; i < ma.length; i++) {
                envUpD += ` L ${scaleX(i)},${scaleY(ma[i] + envOffset)}`;
                envDnD += ` L ${scaleX(i)},${scaleY(ma[i] - envOffset)}`;
            }
            
            const envUp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            envUp.setAttribute('d', envUpD);
            envUp.setAttribute('class', 'envelope-line');
            envUp.setAttribute('fill', 'none');
            
            const envDn = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            envDn.setAttribute('d', envDnD);
            envDn.setAttribute('class', 'envelope-line');
            envDn.setAttribute('fill', 'none');
            
            // Add a smoothed FLD (Forward Line of Demarcation) shifted forward
            const shift = Math.floor(prices.length * 0.1); 
            let fldD = `M ${scaleX(shift)},${scaleY(prices[0])}`;
            for (let i = 1; i < prices.length - shift; i++) {
                fldD += ` L ${scaleX(i+shift)},${scaleY(prices[i])}`;
            }
            const fldPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            fldPath.setAttribute('d', fldD);
            fldPath.setAttribute('class', 'fld-line neon-pink');
            fldPath.setAttribute('stroke', 'var(--neon-pink)');
            fldPath.setAttribute('stroke-width', '2');
            fldPath.setAttribute('fill', 'none');
            
            svg.appendChild(envUp);
            svg.appendChild(envDn);
            svg.appendChild(pricePath);
            svg.appendChild(fldPath);

        } else if (engineType === 'elliott') {
            pricePath.setAttribute('class', 'ew-historical op-low');
            pricePath.setAttribute('stroke', 'var(--neon-cyan)');
            pricePath.setAttribute('stroke-width', '1.5');
            pricePath.setAttribute('opacity', '0.4');

            const len = prices.length;
            const currentPrice = prices[len - 1];

            // ═══════════════════════════════════════════════════════════════════
            // STEP 1: ZigZag pivot algorithm — finds real swing highs & lows
            // Uses a minimum % deviation to filter noise. Adapts threshold to
            // the actual volatility of the stock (AMD swings 50%+, AAPL ~20%).
            // ═══════════════════════════════════════════════════════════════════
            const priceRange = maxPrice - minPrice;
            const priceRangePct = priceRange / (minPrice || 1);
            // Adaptive threshold: 3% for low-vol, up to 8% for high-vol stocks
            const zigZagThresh = Math.min(0.08, Math.max(0.03, priceRangePct * 0.06));

            const zigzagPivots = []; // { idx, val, type: 'H'|'L' }
            let lastPivotVal = prices[0];
            let lastPivotIdx = 0;
            let trend = 0; // 0=unknown, 1=up, -1=down

            for (let i = 1; i < len; i++) {
                if (prices[i] == null) continue;
                const chg = (prices[i] - lastPivotVal) / (Math.abs(lastPivotVal) || 1);

                if (trend >= 0 && chg <= -zigZagThresh) {
                    // Reversal down: record the recent high
                    if (trend === 1) zigzagPivots.push({ idx: lastPivotIdx, val: lastPivotVal, type: 'H' });
                    trend = -1;
                    lastPivotVal = prices[i];
                    lastPivotIdx = i;
                } else if (trend <= 0 && chg >= zigZagThresh) {
                    // Reversal up: record the recent low
                    if (trend === -1) zigzagPivots.push({ idx: lastPivotIdx, val: lastPivotVal, type: 'L' });
                    trend = 1;
                    lastPivotVal = prices[i];
                    lastPivotIdx = i;
                } else {
                    // Extend current trend if price is more extreme
                    if ((trend === 1  && prices[i] > lastPivotVal) ||
                        (trend === -1 && prices[i] < lastPivotVal)) {
                        lastPivotVal = prices[i];
                        lastPivotIdx = i;
                    }
                }
            }
            // Push the final pivot
            zigzagPivots.push({ idx: lastPivotIdx, val: lastPivotVal,
                type: trend >= 0 ? 'H' : 'L' });

            // ═══════════════════════════════════════════════════════════════════
            // STEP 2: Find best 5-wave impulse from ZigZag pivots
            // We need a sequence L-H-L-H-L (W0 W1 W2 W3 W4) where:
            //   Rule A: W2 retracement > 23.6% and < 99% of W1
            //   Rule B: W3 is not the shortest impulse wave
            //   Rule C: W4 does not overlap W1 price territory
            //   Rule D: W3 is typically 1.618× W1 or larger in range
            // We try all valid combos of 5 consecutive L pivot / H pivot combos
            // and score them, picking the best fit.
            // ═══════════════════════════════════════════════════════════════════
            let bestW0, bestW1, bestW2, bestW3, bestW4;
            let bestScore = -Infinity;
            const zLen = zigzagPivots.length;

            // Find sequences of 5 pivots that form L-H-L-H-L for a bullish impulse
            for (let i = 0; i <= zLen - 5; i++) {
                const p0 = zigzagPivots[i];
                const p1 = zigzagPivots[i+1];
                const p2 = zigzagPivots[i+2];
                const p3 = zigzagPivots[i+3];
                const p4 = zigzagPivots[i+4];

                // Must form L-H-L-H-L
                if (p0.type !== 'L' || p1.type !== 'H' || p2.type !== 'L' ||
                    p3.type !== 'H' || p4.type !== 'L') continue;

                const w1h = p1.val - p0.val;  // Wave I height
                const w2h = p1.val - p2.val;  // Wave II retracement
                const w3h = p3.val - p2.val;  // Wave III height
                const w4h = p3.val - p4.val;  // Wave IV retracement

                if (w1h <= 0 || w3h <= 0) continue;

                // Rule A: W2 retracement 23.6%–99% of W1
                const w2ret = w2h / w1h;
                if (w2ret < 0.236 || w2ret > 0.99) continue;

                // Rule B: W3 is NOT the shortest (must be >= W1 and >= W4 approx)
                if (w3h < w1h * 0.9) continue;

                // Rule C: W4 does not enter W1 price territory (p4.val > p1.val - eps)
                if (p4.val <= p1.val * 0.99) continue;

                // Score: STRONGLY prefer more recent waves (recency^3 weight)
                // This prevents ancient COVID-crash lows from dominating for stocks like AAPL
                const w3ext = w3h / w1h;
                const recency = p4.idx / (len - 1); // 0→1, 1 = most recent
                const score = w3h * w3ext * Math.pow(recency, 3);

                if (score > bestScore) {
                    bestScore = score;
                    bestW0 = p0; bestW1 = p1; bestW2 = p2; bestW3 = p3; bestW4 = p4;
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // FALLBACK: if no valid 5-wave found, use meaningful structural pivots
            // Find the global low, global high after it, deepest pullback, biggest
            // secondary high, and current price as W4 bottom.
            // ═══════════════════════════════════════════════════════════════════
            if (!bestW0) {
                // Find overall structural low (first 60% of data)
                let gLowIdx = 0, gLowVal = prices[0];
                for (let i = 1; i < Math.floor(len * 0.6); i++) {
                    if (prices[i] != null && prices[i] < gLowVal) { gLowVal = prices[i]; gLowIdx = i; }
                }
                // Highest high after the low (next 60%)
                let gHighIdx = gLowIdx + 1, gHighVal = prices[gLowIdx + 1] || gLowVal;
                for (let i = gLowIdx + 1; i < Math.floor(len * 0.95); i++) {
                    if (prices[i] != null && prices[i] > gHighVal) { gHighVal = prices[i]; gHighIdx = i; }
                }
                // Deepest pullback between low and high
                let w2Idx = gLowIdx + 1, w2Val = gHighVal;
                for (let i = gLowIdx + 1; i < gHighIdx; i++) {
                    if (prices[i] != null && prices[i] < w2Val) { w2Val = prices[i]; w2Idx = i; }
                }
                // W3 high: biggest high after W2
                let w3Idx = w2Idx + 1, w3Val = prices[w2Idx + 1] || gHighVal;
                for (let i = w2Idx + 1; i < Math.floor(len * 0.95); i++) {
                    if (prices[i] != null && prices[i] > w3Val) { w3Val = prices[i]; w3Idx = i; }
                }
                // W4 low: deepest pull after W3
                let w4Idx = w3Idx + 1, w4Val = prices[w3Idx + 1] || w3Val;
                for (let i = w3Idx + 1; i < len; i++) {
                    if (prices[i] != null && prices[i] < w4Val) { w4Val = prices[i]; w4Idx = i; }
                }
                // Enforce W4 doesn't violate W1 territory
                w4Val = Math.max(w4Val, gHighVal * 1.001);
                bestW0 = { idx: gLowIdx,  val: gLowVal  };
                bestW1 = { idx: gHighIdx, val: gHighVal };
                bestW2 = { idx: w2Idx,    val: w2Val    };
                bestW3 = { idx: w3Idx,    val: w3Val    };
                bestW4 = { idx: w4Idx,    val: w4Val    };
            }

            const w0 = bestW0, w1 = bestW1, w2 = bestW2, w3 = bestW3, w4 = bestW4;

            // ═══════════════════════════════════════════════════════════════════
            // STEP 3: Compute wave heights for Fibonacci projections
            // ═══════════════════════════════════════════════════════════════════
            const wave1H      = Math.abs(w1.val - w0.val);
            const wave3H      = Math.abs(w3.val - w2.val);
            const wave3HFinal = wave3H;

            // W5 Fibonacci projections (from W4 base)
            // Convention: all measured from W4 bottom
            let w5_0618 = w4.val + wave1H * 0.618;
            let w5_equal = w4.val + wave1H * 1.0;
            let w5_1618 = w4.val + wave1H * 1.618;
            let w5_2618 = w4.val + wave1H * 2.618;

            // ─── CONTINUATION FIX ────────────────────────────────────────────────
            // If current price is ABOVE the 1.618 extension, the impulse pattern we
            // found is too old. Re-anchor targets FROM current price upward using
            // the same Fib multiples of wave1H. This correctly handles stocks like
            // AAPL that are deep into Wave V already.
            if (currentPrice > w5_0618) {
                // Determine how far into W5 we already are
                const w5progress = currentPrice - w4.val;
                // Re-project from current price
                const remainH = wave1H * 0.618; // base increment = 0.618 of W1
                w5_0618  = currentPrice + remainH * 0.382; // near-term
                w5_equal  = currentPrice + remainH * 0.618; // mid
                w5_1618  = currentPrice + remainH * 1.0;   // extended
                w5_2618  = currentPrice + remainH * 1.618;  // rare
            }

            const w5TargetVal = w5_0618;
            const w5ext1618   = w5_1618;

            // Retracement percentages for display
            const w2Ret = Math.max(0, Math.min(100, ((w1.val - w2.val) / wave1H * 100))).toFixed(0);
            const w3Ext = (wave3HFinal / wave1H * 100).toFixed(0);
            const w4Ret = Math.max(0, Math.min(100, ((w3.val - w4.val) / wave3HFinal * 100))).toFixed(0);

            // ═══════════════════════════════════════════════════════════════════
            // STEP 4: Sub-waves inside Wave III using ZigZag pivots
            // Use ZigZag pivots that fall within [w2.idx, w3.idx] range
            // ═══════════════════════════════════════════════════════════════════
            const subPivots = zigzagPivots.filter(p => p.idx > w2.idx && p.idx < w3.idx);
            let sub1, sub2, sub3, sub4;

            if (subPivots.length >= 4) {
                // Use first high, first low after that, biggest high, deepest low
                const subHighs = subPivots.filter(p => p.type === 'H').sort((a, b) => a.idx - b.idx);
                const subLows  = subPivots.filter(p => p.type === 'L').sort((a, b) => a.idx - b.idx);
                sub1 = subHighs[0] || { idx: w2.idx + Math.floor((w3.idx - w2.idx) * 0.25), val: w2.val + wave3HFinal * 0.22 };
                sub2 = subLows[0]  || { idx: sub1.idx + Math.floor((w3.idx - sub1.idx) * 0.25), val: sub1.val - wave3HFinal * 0.12 };
                sub3 = subHighs[1] || { idx: sub2.idx + Math.floor((w3.idx - sub2.idx) * 0.50), val: sub2.val + wave3HFinal * 0.45 };
                sub4 = subLows[1]  || { idx: sub3.idx + Math.floor((w3.idx - sub3.idx) * 0.40), val: sub3.val - wave3HFinal * 0.08 };
            } else {
                // Synthesize from proportions if no zigzag pivots inside W3
                const sl = w3.idx - w2.idx;
                sub1 = { idx: w2.idx + Math.floor(sl * 0.22), val: w2.val + wave3HFinal * 0.20 };
                sub2 = { idx: w2.idx + Math.floor(sl * 0.38), val: w2.val + wave3HFinal * 0.08 };
                sub3 = { idx: w2.idx + Math.floor(sl * 0.62), val: w2.val + wave3HFinal * 0.62 };
                sub4 = { idx: w2.idx + Math.floor(sl * 0.80), val: w2.val + wave3HFinal * 0.50 };
            }
            const sub5 = { idx: w3.idx, val: w3.val };

            // ═══════════════════════════════════════════════════════════════════
            // STEP 5: Correction targets (from W5 peak after W4 base)
            // Correction patterns: project from W5 apex → downside
            // corrTop = where the post-W5 correction starts from (the W5 target)
            // corrBase = the W4 support zone (realistic support floor)
            // If we're in continuation mode, base it on current price
            const corrTop  = w5_0618;                                              // W5 completion / correction START
            const corrBase = Math.max(currentPrice * 0.75, w4.val);               // Support floor (never below 75% of current)
            const corrRange = Math.max(corrTop - corrBase, currentPrice * 0.08);  // Min 8% range so targets are always visible

            const czC_y  = Math.max(corrTop - corrRange * 0.618, corrBase * 1.01); // Zigzag: 61.8% retrace
            const cfC_y  = Math.max(corrTop - corrRange * 0.10,  corrBase * 1.01); // Flat: ~10% shallow
            const cxC_y  = Math.max(corrTop - corrRange * 0.786, corrBase * 1.01); // Exp Flat: deep 78.6%
            const czB_y  = corrTop - corrRange * 0.38;
            const cfB_y  = corrTop * 0.994;
            const cxB_y  = corrTop * 1.03;
            const triA_y = corrTop;
            const triB_y = czB_y;
            const triC_y = triA_y - (triA_y - triB_y) * 0.72;
            const triD_y = triB_y + (triA_y - triB_y) * 0.30;
            const triE_y = triC_y + (triC_y - triD_y) * 0.40;
            const dblX1_y = corrTop - corrRange * 0.55;
            const dblX_y  = corrTop - corrRange * 0.22;
            const dblY_y  = Math.max(corrTop - corrRange * 0.786, corrBase * 1.01);


            // ═══════════════════════════════════════════════════════════════════
            // STEP 6: SVG Drawing
            // ═══════════════════════════════════════════════════════════════════
            const barW    = (width - padding * 2) / (len - 1);
            const futureX = (slots) => Math.min(scaleX(len - 1) + slots * barW, width - 6);

            const corrFutMid = 55, corrFutEnd = 110;
            const futW5_primary = 40, futW5_equal = 60, futW5_extended = 90;

            // Fibonacci reference lines
            const fibLevels = [
                { price: w0.val,  color: 'rgba(0,240,255,0.22)', label: 'W0 Low' },
                { price: w2.val,  color: 'rgba(0,240,255,0.18)', label: 'W2 Low' },
                { price: w3.val,  color: 'rgba(57,255,20,0.22)', label: 'W3 High' },
                { price: w4.val,  color: 'rgba(255,215,0,0.22)', label: 'W4 Base' },
                { price: w5_0618, color: 'rgba(57,255,20,0.30)', label: `W5 Min $${w5_0618.toFixed(0)}` },
                { price: w5_equal,color: 'rgba(0,240,255,0.22)', label: `W5=$W1 $${w5_equal.toFixed(0)}` },
            ];
            let fibHtml = '';
            fibLevels.forEach(fl => {
                const fy = scaleY(fl.price);
                if (fy >= 0 && fy <= height) {
                    fibHtml += `<line x1="0" y1="${fy}" x2="${width}" y2="${fy}"
                      stroke="${fl.color}" stroke-width="1" stroke-dasharray="3,6"/>
                    <text x="4" y="${fy - 3}" fill="${fl.color.replace(/[\d.]+\)$/, '0.9)')}"
                      font-size="9">${fl.label}</text>`;
                }
            });

            // Impulse channel lines
            const chSlopeN = (scaleY(w2.val) - scaleY(w0.val));
            const chSlopeD = (scaleX(w2.idx) - scaleX(w0.idx));
            const channelSlope = chSlopeD !== 0 ? chSlopeN / chSlopeD : 0;
            const channelUpperY0   = scaleY(w1.val);
            const channelUpperYEnd = channelUpperY0 + channelSlope * (width - scaleX(w1.idx));
            const channelLowerY0   = scaleY(w0.val);
            const channelLowerYEnd = channelLowerY0 + channelSlope * (width - scaleX(w0.idx));
            const channelHtml = `
              <line x1="${scaleX(w0.idx)}" y1="${channelLowerY0}" x2="${width}" y2="${channelLowerYEnd}"
                stroke="rgba(0,240,255,0.18)" stroke-width="1" stroke-dasharray="4,8"/>
              <line x1="${scaleX(w1.idx)}" y1="${channelUpperY0}" x2="${width}" y2="${channelUpperYEnd}"
                stroke="rgba(0,240,255,0.18)" stroke-width="1" stroke-dasharray="4,8"/>
            `;

            // W5 projection defs + lines
            // Anchor: if already into W5 (continuation mode), start from NOW; otherwise from W4
            const projAnchorX   = scaleX(len - 1);   // always project from NOW bar
            const projAnchorY   = scaleY(currentPrice);
            const w5ProjectHtml = `
              <defs>
                <marker id="arrG" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto">
                  <path d="M0,1 L6,3.5 L0,6 Z" fill="rgba(57,255,20,0.9)"/></marker>
                <marker id="arrC" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto">
                  <path d="M0,1 L6,3.5 L0,6 Z" fill="rgba(0,240,255,0.8)"/></marker>
                <marker id="arrY" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto">
                  <path d="M0,1 L6,3.5 L0,6 Z" fill="rgba(255,215,0,0.8)"/></marker>
              </defs>
              <!-- Primary W5 green arrow -->
              <line x1="${projAnchorX}" y1="${projAnchorY}"
                    x2="${futureX(futW5_primary)}" y2="${scaleY(w5_0618)}"
                    stroke="rgba(57,255,20,0.9)" stroke-width="2.5" stroke-dasharray="7,4"
                    marker-end="url(#arrG)"/>
              <text x="${futureX(futW5_primary) - 42}" y="${scaleY(w5_0618) - 8}"
                    fill="rgba(57,255,20,1)" font-size="10" font-weight="bold">(V) $${w5_0618.toFixed(2)}</text>

              <!-- Equal W1 cyan -->
              <line x1="${projAnchorX}" y1="${projAnchorY}"
                    x2="${futureX(futW5_equal)}" y2="${scaleY(w5_equal)}"
                    stroke="rgba(0,240,255,0.75)" stroke-width="1.8" stroke-dasharray="5,5"
                    marker-end="url(#arrC)"/>
              <text x="${futureX(futW5_equal) - 42}" y="${scaleY(w5_equal) - 8}"
                    fill="rgba(0,240,255,0.9)" font-size="9" font-weight="bold">$${w5_equal.toFixed(2)}</text>

              <!-- 1.618 gold -->
              <line x1="${projAnchorX}" y1="${projAnchorY}"
                    x2="${futureX(futW5_extended)}" y2="${scaleY(w5_1618)}"
                    stroke="rgba(255,215,0,0.7)" stroke-width="1.5" stroke-dasharray="4,6"
                    marker-end="url(#arrY)"/>
              <text x="${futureX(futW5_extended) - 54}" y="${scaleY(w5_1618) - 8}"
                    fill="rgba(255,215,0,0.9)" font-size="9" font-weight="bold">Ext $${w5_1618.toFixed(2)}</text>

              <!-- Target zone box -->
              <rect x="${projAnchorX + 4}" y="${scaleY(w5_equal)}"
                    width="${Math.max(2, futureX(futW5_equal) - projAnchorX - 4)}"
                    height="${Math.max(2, scaleY(w5_0618) - scaleY(w5_equal))}"
                    fill="rgba(57,255,20,0.04)" stroke="rgba(57,255,20,0.2)"
                    stroke-width="1" stroke-dasharray="2,4"/>

              <!-- NOW line -->
              <line x1="${scaleX(len-1)}" y1="0" x2="${scaleX(len-1)}" y2="${height}"
                    stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="2,4"/>
              <text x="${scaleX(len-1) + 3}" y="14" fill="rgba(255,255,255,0.45)" font-size="8">NOW</text>
            `;


            // Sub-wave path inside Wave III
            const subWavePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            subWavePath.setAttribute('d',
                `M ${scaleX(w2.idx)},${scaleY(w2.val)}
                 L ${scaleX(sub1.idx)},${scaleY(sub1.val)}
                 L ${scaleX(sub2.idx)},${scaleY(sub2.val)}
                 L ${scaleX(sub3.idx)},${scaleY(sub3.val)}
                 L ${scaleX(sub4.idx)},${scaleY(sub4.val)}
                 L ${scaleX(sub5.idx)},${scaleY(sub5.val)}`);
            subWavePath.setAttribute('stroke', 'rgba(0,240,255,0.7)');
            subWavePath.setAttribute('stroke-width', '1.4');
            subWavePath.setAttribute('stroke-dasharray', '5,3');
            subWavePath.setAttribute('fill', 'none');

            // Main 5-wave impulse line (W0→W4)
            const ewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            ewPath.setAttribute('d',
                `M ${scaleX(w0.idx)},${scaleY(w0.val)}
                 L ${scaleX(w1.idx)},${scaleY(w1.val)}
                 L ${scaleX(w2.idx)},${scaleY(w2.val)}
                 L ${scaleX(w3.idx)},${scaleY(w3.val)}
                 L ${scaleX(w4.idx)},${scaleY(w4.val)}`);
            ewPath.setAttribute('stroke', 'var(--neon-green)');
            ewPath.setAttribute('stroke-width', '2.5');
            ewPath.setAttribute('fill', 'none');

            // Correction scenario paths (all project from current price rightward)
            const mkPath = (d, stroke, sw, dash, op) => {
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p.setAttribute('d', d); p.setAttribute('stroke', stroke);
                p.setAttribute('stroke-width', sw); p.setAttribute('stroke-dasharray', dash);
                p.setAttribute('fill', 'none'); p.setAttribute('opacity', op); return p;
            };

            const zigzagPath = mkPath(
                `M ${scaleX(len-1)},${scaleY(currentPrice)}
                 L ${futureX(corrFutMid*0.38)},${scaleY(w5_0618)}
                 L ${futureX(corrFutMid*0.70)},${scaleY(czB_y)}
                 L ${futureX(corrFutEnd)},${scaleY(czC_y)}`,
                'var(--neon-red)', '1.8', '6,4', '0.85');

            const flatPath = mkPath(
                `M ${scaleX(len-1)},${scaleY(currentPrice)}
                 L ${futureX(corrFutMid*0.38)},${scaleY(w5_0618)}
                 L ${futureX(corrFutMid*0.70)},${scaleY(cfB_y)}
                 L ${futureX(corrFutEnd)},${scaleY(cfC_y)}`,
                '#ffaa00', '1.6', '8,4', '0.8');

            const expFlatPath = mkPath(
                `M ${scaleX(len-1)},${scaleY(currentPrice)}
                 L ${futureX(corrFutMid*0.38)},${scaleY(w5_0618)}
                 L ${futureX(corrFutMid*0.70)},${scaleY(cxB_y)}
                 L ${futureX(corrFutEnd)},${scaleY(cxC_y)}`,
                '#ffe000', '1.4', '4,6', '0.7');

            const triPath = mkPath(
                `M ${scaleX(len-1)},${scaleY(currentPrice)}
                 L ${futureX(corrFutMid*0.20)},${scaleY(triA_y)}
                 L ${futureX(corrFutMid*0.40)},${scaleY(triB_y)}
                 L ${futureX(corrFutMid*0.60)},${scaleY(triC_y)}
                 L ${futureX(corrFutMid*0.80)},${scaleY(triD_y)}
                 L ${futureX(corrFutMid)},${scaleY(triE_y)}`,
                '#cc88ff', '1.4', '3,5', '0.75');

            const dblPath = mkPath(
                `M ${scaleX(len-1)},${scaleY(currentPrice)}
                 L ${futureX(corrFutMid*0.18)},${scaleY(w5_0618)}
                 L ${futureX(corrFutMid*0.35)},${scaleY(dblX1_y)}
                 L ${futureX(corrFutMid*0.52)},${scaleY(dblX_y)}
                 L ${futureX(corrFutEnd*0.85)},${scaleY(dblY_y)}`,
                'var(--neon-pink)', '1.4', '2,5', '0.7');

            // Wave labels
            const labelsHtml = `
                <text x="${scaleX(w0.idx)+4}" y="${scaleY(w0.val)+15}" fill="var(--neon-green)" font-size="11" font-weight="bold">(0)</text>
                <text x="${scaleX(w1.idx)+4}" y="${scaleY(w1.val)-8}" fill="var(--neon-green)" font-size="11" font-weight="bold">(I)</text>
                <text x="${scaleX(w1.idx)+4}" y="${scaleY(w1.val)-20}" fill="rgba(57,255,20,0.7)" font-size="9">+${((w1.val-w0.val)/w0.val*100).toFixed(1)}%</text>
                <text x="${scaleX(w2.idx)+4}" y="${scaleY(w2.val)+16}" fill="var(--neon-cyan)" font-size="11" font-weight="bold">(II)</text>
                <text x="${scaleX(w2.idx)+4}" y="${scaleY(w2.val)+28}" fill="rgba(0,240,255,0.7)" font-size="9">${w2Ret}% ret</text>
                <text x="${scaleX(w3.idx)+4}" y="${scaleY(w3.val)-8}" fill="var(--neon-green)" font-size="11" font-weight="bold">(III)</text>
                <text x="${scaleX(w3.idx)+4}" y="${scaleY(w3.val)-20}" fill="rgba(57,255,20,0.7)" font-size="9">${w3Ext}% of I</text>
                <text x="${scaleX(w4.idx)+4}" y="${scaleY(w4.val)+16}" fill="var(--neon-cyan)" font-size="11" font-weight="bold">(IV)</text>
                <text x="${scaleX(w4.idx)+4}" y="${scaleY(w4.val)+28}" fill="rgba(0,240,255,0.7)" font-size="9">${w4Ret}% ret</text>
                <text x="${scaleX(len-1)+4}" y="${scaleY(currentPrice)-6}" fill="rgba(255,255,255,0.6)" font-size="9">NOW $${currentPrice.toFixed(2)}</text>
                <text x="${scaleX(sub1.idx)+3}" y="${scaleY(sub1.val)-6}" fill="rgba(0,240,255,0.8)" font-size="9">i</text>
                <text x="${scaleX(sub2.idx)+3}" y="${scaleY(sub2.val)+13}" fill="rgba(0,240,255,0.8)" font-size="9">ii</text>
                <text x="${scaleX(sub3.idx)+3}" y="${scaleY(sub3.val)-6}" fill="rgba(0,240,255,0.8)" font-size="9">iii</text>
                <text x="${scaleX(sub4.idx)+3}" y="${scaleY(sub4.val)+13}" fill="rgba(0,240,255,0.8)" font-size="9">iv</text>
                <text x="${scaleX(sub5.idx)-14}" y="${scaleY(sub5.val)-6}" fill="rgba(0,240,255,0.8)" font-size="9">v</text>
                <text x="${futureX(corrFutEnd) - 48}" y="${scaleY(czC_y)+13}" fill="rgba(255,80,80,0.85)" font-size="9">Zig C</text>
                <text x="${futureX(corrFutEnd) - 48}" y="${scaleY(cfC_y)-4}" fill="rgba(255,170,0,0.85)" font-size="9">Flat C</text>
                <text x="${futureX(corrFutEnd) - 56}" y="${scaleY(cxC_y)+13}" fill="rgba(255,224,0,0.85)" font-size="9">ExpFlat</text>
                <text x="${futureX(corrFutMid) - 48}" y="${scaleY(triE_y)+13}" fill="rgba(204,136,255,0.85)" font-size="9">Tri E</text>
                <text x="${futureX(corrFutEnd*0.85) - 50}" y="${scaleY(dblY_y)+13}" fill="rgba(255,20,147,0.85)" font-size="9">DblZZ Y</text>
            `;

            // ── Targets Table (right corner) ────────────────────────────────────
            const tblW = 214, tblH = 196, tblY = 8;
            const tblX = Math.max(width - tblW - 8, 2);
            const row  = (y, label, val, color, bold) =>
              `<text x="${tblX+8}" y="${tblY+y}" fill="${color}"
                font-size="${bold?'10.5':'9'}" font-weight="${bold?'bold':'normal'}">${label}</text>
               <text x="${tblX+tblW-8}" y="${tblY+y}" fill="${color}"
                font-size="${bold?'10.5':'9'}" font-weight="bold" text-anchor="end">${val}</text>`;

            const legendHtml = `
              <g>
                <rect x="${tblX}" y="${tblY}" width="${tblW}" height="${tblH}"
                      fill="rgba(0,0,0,0.75)" rx="5" stroke="rgba(0,240,255,0.35)" stroke-width="1"/>
                <text x="${tblX+tblW/2}" y="${tblY+16}" fill="rgba(0,240,255,1)"
                      font-size="11" font-weight="bold" text-anchor="middle">⚡ PRICE TARGETS</text>
                <line x1="${tblX+6}" y1="${tblY+20}" x2="${tblX+tblW-6}" y2="${tblY+20}"
                      stroke="rgba(0,240,255,0.4)" stroke-width="1"/>

                <text x="${tblX+8}" y="${tblY+33}" fill="rgba(57,255,20,0.85)"
                      font-size="9" font-weight="bold">── WAVE (V) UPSIDE TARGETS ──</text>
                ${row(46,  '▶ Min  (0.618×W1)', '$'+w5_0618.toFixed(2),  'rgba(57,255,20,1)',   true)}
                ${row(59,  '▶ Base (1.0×W1)',   '$'+w5_equal.toFixed(2), 'rgba(0,240,255,1)',   true)}
                ${row(72,  '▶ Ext  (1.618×W1)', '$'+w5_1618.toFixed(2),  'rgba(255,215,0,1)',   true)}
                ${row(85,  '▶ Rare (2.618×W1)', '$'+w5_2618.toFixed(2),  'rgba(255,170,0,0.8)', false)}

                <line x1="${tblX+6}" y1="${tblY+92}" x2="${tblX+tblW-6}" y2="${tblY+92}"
                      stroke="rgba(255,50,50,0.4)" stroke-width="1"/>
                <text x="${tblX+8}" y="${tblY+103}" fill="rgba(255,80,80,0.85)"
                      font-size="9" font-weight="bold">── CORRECTION DOWNSIDE ──</text>
                ${row(116, '● Zigzag C (61.8%)',   '$'+czC_y.toFixed(2),  'rgba(255,80,80,1)',    true)}
                ${row(129, '● Flat C   (~W4)',     '$'+cfC_y.toFixed(2),  'rgba(255,170,0,1)',    true)}
                ${row(142, '● Exp.Flat (61.8%)',   '$'+cxC_y.toFixed(2),  'rgba(255,224,0,0.9)', true)}
                ${row(155, '● Triangle E',         '$'+triE_y.toFixed(2), 'rgba(204,136,255,1)',  false)}
                ${row(168, '● DblZigzag Y',        '$'+dblY_y.toFixed(2), 'rgba(255,20,147,0.9)',false)}

                <line x1="${tblX+6}" y1="${tblY+176}" x2="${tblX+tblW-6}" y2="${tblY+176}"
                      stroke="rgba(0,240,255,0.15)" stroke-width="1"/>
                <text x="${tblX+tblW/2}" y="${tblY+188}" fill="rgba(255,255,255,0.35)"
                      font-size="7" text-anchor="middle">W1=$${w1.val.toFixed(2)} | W4=$${w4.val.toFixed(2)} | W1H=${wave1H.toFixed(2)}</text>
              </g>`;

            // Render order: fib + channel → sub-waves → corrections → impulse → labels+table
            svg.innerHTML += fibHtml + channelHtml + w5ProjectHtml;
            svg.appendChild(subWavePath);
            svg.appendChild(zigzagPath);
            svg.appendChild(flatPath);
            svg.appendChild(expFlatPath);
            svg.appendChild(triPath);
            svg.appendChild(dblPath);
            svg.appendChild(ewPath);
            svg.innerHTML += labelsHtml + legendHtml;

            // Update DOM target display
            const targetPriceEl = document.getElementById('elliott-target-price');
            const targetTitleEl = document.getElementById('elliott-target-title');
            if (targetPriceEl) targetPriceEl.textContent = `$${w5TargetVal.toFixed(2)} – $${w5ext1618.toFixed(2)}`;
            if (targetTitleEl) targetTitleEl.textContent = `Wave (V) Zone | Ext 1.618: $${w5ext1618.toFixed(2)}`;

        } else if (engineType === 'legacy') {
            pricePath.setAttribute('stroke', 'var(--text-main)');
            pricePath.setAttribute('stroke-width', '2');
            
            const pattern = recognizePattern(history);
            let geometryHtml = '';

            if (pattern.type === 'head_shoulders') {
                const midY = scaleY(prices[Math.floor(prices.length * 0.8)]);
                geometryHtml = `<line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="var(--neon-pink)" stroke-width="2" stroke-dasharray="4,4" />`;
            } else if (pattern.type === 'double_top') {
                const y = scaleY(pattern.resistance);
                geometryHtml = `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="var(--neon-pink)" stroke-width="2" stroke-dasharray="4,4" />`;
            } else if (pattern.type === 'double_bottom') {
                const y = scaleY(pattern.support);
                geometryHtml = `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="var(--neon-green)" stroke-width="2" stroke-dasharray="4,4" />`;
            } else if (pattern.type === 'ascending_triangle') {
                const resY = scaleY(pattern.resistance);
                const sup1X = scaleX(pattern.supportStart.index);
                const sup1Y = scaleY(pattern.supportStart.price);
                const sup2X = scaleX(pattern.supportEnd.index);
                const sup2Y = scaleY(pattern.supportEnd.price);
                const slope = (sup2Y - sup1Y) / (sup2X - sup1X);
                const endY = sup1Y + slope * (width - sup1X);
                
                geometryHtml = `
                    <line x1="0" y1="${resY}" x2="${width}" y2="${resY}" stroke="var(--neon-pink)" stroke-width="2" stroke-dasharray="4,4" />
                    <line x1="${sup1X}" y1="${sup1Y}" x2="${width}" y2="${endY}" stroke="var(--neon-green)" stroke-width="2" stroke-dasharray="4,4" />
                `;
            } else {
                const resY = scaleY(pattern.res);
                const supY = scaleY(pattern.sup);
                geometryHtml = `
                    <line x1="0" y1="${resY}" x2="${width}" y2="${resY}" stroke="var(--neon-pink)" stroke-width="2" stroke-dasharray="4,4" />
                    <line x1="0" y1="${supY}" x2="${width}" y2="${supY}" stroke="var(--neon-cyan)" stroke-width="2" stroke-dasharray="4,4" />
                `;
            }

            svg.innerHTML += `
                <text x="${width/2}" y="20" class="ew-label pattern-title-txt" fill="var(--text-main)" id="pattern-title-text-svg" text-anchor="middle" data-raw-text="${pattern.text}">${pattern.text}</text>
                ${geometryHtml}
                <text x="10" y="${height - 10}" fill="var(--neon-cyan)" font-size="10" id="pattern-desc-text-svg">${pattern.desc}</text>
            `;
        }

        svg.appendChild(pricePath);
    };

    // ─── Mouse Drag Pan Support for all chart containers ─────────────────────
    // Each container stores its own pan offset (in data bar units).
    // Dragging left shows older data, dragging right shows newer data.
    const panState = new Map(); // containerId → { isDragging, startX, startOffset }

    const initPan = (container) => {
        const containerId = container.id;
        if (!panState.has(containerId)) {
            panState.set(containerId, { isDragging: false, startX: 0, startOffset: 0 });
        }
        const svg = container.querySelector('svg');
        if (!svg || svg.dataset.panInited) return;
        svg.dataset.panInited = 'true';
        svg.style.cursor = 'grab';

        svg.addEventListener('mousedown', (e) => {
            const state = panState.get(containerId);
            if (!state || !activeHistoryData) return;
            state.isDragging = true;
            state.startX = e.clientX;
            state.startOffset = zoomDomain ? zoomDomain[0] : 0;
            svg.style.cursor = 'grabbing';
            e.preventDefault();
        });

        svg.addEventListener('mousemove', (e) => {
            const state = panState.get(containerId);
            if (!state || !state.isDragging || !activeHistoryData) return;

            const svgW = svg.clientWidth || 500;
            const totalBars = activeHistoryData.length;
            const visibleBars = zoomDomain
                ? (zoomDomain[1] - zoomDomain[0])
                : totalBars;

            // Pixels per bar in the current view
            const pxPerBar = (svgW - 40) / Math.max(visibleBars - 1, 1);
            const deltaPx  = e.clientX - state.startX;
            const deltaBar = Math.round(-deltaPx / pxPerBar); // neg px = drag right = newer data

            const newStart = Math.max(0, Math.min(state.startOffset + deltaBar, totalBars - 10));
            const newEnd   = zoomDomain ? Math.min(newStart + visibleBars, totalBars - 1) : totalBars - 1;

            zoomDomain = [newStart, newEnd];

            const engineType = container.getAttribute('data-engine') || 'legacy';
            const slicedHistory = activeHistoryData.slice(newStart, newEnd + 1);
            drawDynamicChart(containerId, slicedHistory, engineType);
        });

        const endDrag = () => {
            const state = panState.get(containerId);
            if (!state) return;
            state.isDragging = false;
            svg.style.cursor = 'grab';
        };
        svg.addEventListener('mouseup', endDrag);
        svg.addEventListener('mouseleave', endDrag);
    };

    // Attach pan to all existing chart containers
    document.querySelectorAll('.chart-container').forEach(c => initPan(c));

    const startSocialSentimentStream = () => {
        const hotList = document.getElementById('social-hot-list');
        if (!hotList) return;

        const tickers = ['NVDA', 'TSLA', 'PLTR', 'SMCI', 'COIN', 'MSTR', 'AMD', 'AAPL'];
        const platforms = ['X / Twitter', 'Reddit r/WallStreetBets', 'StockTwits', 'Bloomberg Terminal', 'Discord Alpha'];
        const messages = [
            "Unusual options volume detected.",
            "Chatter spiking on Earnings play.",
            "Regulatory fears trending across FinTwit.",
            "Retail squeeze momentum building.",
            "Dark pool prints indicating accumulation.",
            "CEO tweet driving algorithmic buying."
        ];

        setInterval(() => {
            const ticker = tickers[Math.floor(Math.random() * tickers.length)];
            const isBull = Math.random() > 0.4; // 60% chance bull
            const pct = Math.floor(Math.random() * 20) + 80; // 80-99%
            const platform = platforms[Math.floor(Math.random() * platforms.length)];

            const card = document.createElement('div');
            card.className = `hot-card ${isBull ? 'bullish' : 'bearish'}`;
            card.style.animation = 'flashCard 1s ease-out';
            card.innerHTML = `
                <div class="hc-header">
                    <span class="hc-ticker">${ticker}</span>
                    <span class="hc-sentiment">${pct}% ${isBull ? 'BULL' : 'BEAR'}</span>
                </div>
                <div class="hc-body">"${messages[Math.floor(Math.random() * messages.length)]}"</div>
                <div style="font-size:0.65rem; color:var(--text-muted); margin-top:5px;">Source: ${platform}</div>
            `;

            hotList.insertBefore(card, hotList.firstChild);

            // Keep only latest 5
            if (hotList.children.length > 5) {
                hotList.removeChild(hotList.lastChild);
            }
        }, 8000);
    };

    const startLiveAlertsStream = () => {
        const liveAlerts = document.getElementById('live-alerts');
        if (!liveAlerts) return;

        liveAlerts.addEventListener('click', (e) => {
            if (e.target.classList.contains('ticker-badge')) {
                const ticker = e.target.textContent;
                const searchInput = document.getElementById('tickerSearch');
                if (searchInput) {
                    searchInput.value = ticker;
                    const searchBtn = document.getElementById('btnSearch');
                    if (searchBtn) searchBtn.click();
                }
                
                const deepDiveBtn = document.querySelector('.tab-btn[data-target="tab-deepdive"]');
                if (deepDiveBtn) {
                    deepDiveBtn.click();
                }
            }
        });

        const tickers = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'SPY', 'QQQ', 'MSFT', 'META'];
        const types = ['IB Breakout', 'ICT Order Block', 'Liquidity Sweep', 'VWAP Rejection', 'MACD Cross'];
        
        setInterval(() => {
            const ticker = tickers[Math.floor(Math.random() * tickers.length)];
            const type = types[Math.floor(Math.random() * types.length)];
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const alertItem = document.createElement('div');
            alertItem.className = 'alert-item';
            alertItem.style.animation = 'flashCard 1s ease-out';
            
            let desc = '';
            if (type.includes('Breakout')) desc = `Price broke key levels with high relative volume.`;
            else if (type.includes('ICT')) desc = `Pulled back to 15m Order Block. Institutional sponsorship evident.`;
            else if (type.includes('Sweep')) desc = `Swept previous liquidity pools and aggressively rejected.`;
            else desc = `Algorithmic momentum shift detected.`;

            alertItem.innerHTML = `
                <div class="alert-time">${time}</div>
                <div class="alert-type">${type}</div>
                <div class="alert-desc"><span class="ticker-badge">${ticker}</span> ${desc}</div>
            `;
            
            liveAlerts.insertBefore(alertItem, liveAlerts.firstChild);
            
            if (liveAlerts.children.length > 5) {
                liveAlerts.removeChild(liveAlerts.lastChild);
            }
        }, 6000);
    };

    const handleSearch = async (isSilentUpdate = false) => {
        let ticker = activeTickerStr;
        if (!isSilentUpdate) {
            ticker = searchInput.value.trim().toUpperCase();
            if (!ticker) return;

            // Reset search bar and update news feed status
            searchInput.value = '';
            newsFeed.innerHTML = `<div class="news-item">Fetching live market data via proxy server for <span class="neon-cyan">$${ticker}</span>...</div>`;
        }

        try {
            // Fetch the financial data
            const data = await fetchStockData(ticker);
            
            const sign = data.change >= 0 ? '+' : '';
            const colorClass = data.change >= 0 ? 'bullish' : 'bearish';
            const priceNum = parseFloat(data.price);
            const fibUp = (priceNum * 1.05).toFixed(2);
            const fibDown = (priceNum * 0.95).toFixed(2);

            // Set global data state for zoom re-draws
            activeTickerStr = ticker;
            activeHistoryData = data.history;
            if (!zoomDomain) {
                // Default to full history on first search
                zoomDomain = [0, data.history.length - 1];
            } else {
                // Keep the domain size, but attach it to the tail (latest data)
                const windowSize = zoomDomain[1] - zoomDomain[0];
                zoomDomain = [data.history.length - 1 - windowSize, data.history.length - 1];
                if (zoomDomain[0] < 0) zoomDomain[0] = 0;
            }

            const visibleHistory = activeHistoryData.slice(zoomDomain[0], zoomDomain[1] + 1);

            // Render chart axes based on new price and history
            renderChartAxes(ticker, data.price, visibleHistory);

            // Fetch live Google News
            const newsHtml = await fetchGoogleNews(ticker);
            newsFeed.innerHTML = newsHtml;

            // Update all Chart Panel Titles across tabs
            document.querySelectorAll('.panel-title').forEach(title => {
                const originalTitle = title.getAttribute('data-original-title') || title.textContent;
                if(!title.hasAttribute('data-original-title')) {
                    title.setAttribute('data-original-title', originalTitle);
                }
                title.innerHTML = `<span class="neon-cyan">${ticker}</span> - ${originalTitle}`;
            });

            // Update Unified Verdict Box context
            const verdictHeader = document.querySelector('.verdict-header h2');
            if (verdictHeader) {
                verdictHeader.innerHTML = `TRI-ENGINE UNIFIED VERDICT: <span class="neon-cyan">${ticker}</span>`;
            }

            const patternObj = recognizePattern(visibleHistory);

            // Dynamically update unified verdict panel values based on data changes
            const isBullish = parseFloat(data.change) >= 0;
            const volatility = Math.abs(parseFloat(data.changePercent));
            const baseConf = 60 + Math.min(30, volatility * 5);

            // Use the same deterministic seed for dynamic text variations
            let seedCharHash = 0;
            for (let i = 0; i < ticker.length; i++) {
                seedCharHash += ticker.charCodeAt(i) * (i+1);
            }
            const seed = seedCharHash * 1000 + (data.history.length * 7);

            document.getElementById('v-ewave-val').textContent = isBullish ? 'BULLISH' : 'BEARISH';
            document.getElementById('v-ewave-val').className = `v-value ${isBullish ? 'neon-green' : 'neon-red'}`;
            
            const bullishWaves = ['Wave (I) Accumulation', 'Wave (III) Advancement', 'Wave (V) Target Active'];
            const bearishWaves = ['Wave (A) Correction Initiated', 'Wave (C) Sharp Correction', 'Extended Bear Cycle'];
            const ewaveStr = isBullish ? bullishWaves[seed % 3] : bearishWaves[seed % 3];
            document.getElementById('v-ewave-sub').textContent = ewaveStr;

            document.getElementById('v-gann-val').textContent = isBullish ? 'BULLISH' : 'BEARISH';
            document.getElementById('v-gann-val').className = `v-value ${isBullish ? 'neon-green' : 'neon-red'}`;
            
            const bullishGannAngles = ['Above 1x1 Angle', 'Climbing 2x1 Angle', 'Supported by 4x1', 'Testing 8x1 Arc'];
            const bearishGannAngles = ['Below 1x1 Angle', 'Failing 1x2 Angle', 'Rejected at Square of 9', 'Crushed below 1x4'];
            const gannStr = isBullish ? bullishGannAngles[seed % 4] : bearishGannAngles[seed % 4];
            document.getElementById('v-gann-sub').textContent = gannStr;

            document.getElementById('v-hurst-val').textContent = volatility > 2 ? (isBullish ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
            document.getElementById('v-hurst-val').className = `v-value ${volatility > 2 ? (isBullish ? 'neon-green' : 'neon-red') : 'neon-cyan'}`;
            document.getElementById('v-hurst-sub').textContent = `Phase ${isBullish ? 'Expansion' : 'Contraction'} Window`;

            document.getElementById('v-score-val').textContent = `${Math.floor(baseConf)}%`;
            document.getElementById('v-score-val').className = `score-value ${isBullish ? 'neon-green' : 'neon-red'}`;

            document.getElementById('v-action-zone').textContent = `${patternObj.text} | Pivot $${data.price}`;
            document.getElementById('v-action-btn').textContent = isBullish ? 'LONG SETUP' : 'SHORT SETUP';
            // Assuming button class toggles between buy and sell colors roughly
            document.getElementById('v-action-btn').className = `btn btn-action ${isBullish ? 'buy' : 'sell'}`;

            // Populate Trade Plan fields dynamically
            if (document.getElementById('v-entry-price')) {
                const entryVal = parseFloat(data.price);
                const tgtMul = isBullish ? 1.08 : 0.92;
                const stpMul = isBullish ? 0.96 : 1.04;
                
                document.getElementById('v-entry-price').textContent = `$${entryVal.toFixed(2)}`;
                document.getElementById('v-target-price').textContent = `$${(entryVal * tgtMul).toFixed(2)}`;
                document.getElementById('v-stop-price').textContent = `$${(entryVal * stpMul).toFixed(2)}`;
                
                document.getElementById('v-exit-plan').innerHTML = isBullish 
                    ? 'Scale 50% at Target<br/>Trail Stop to Entry' 
                    : 'Cover 50% at Target<br/>Hold runner';
            }

            // Populate Financial Health Matrix 
            if (document.getElementById('h-rev-val')) {
                 const fundRaw = await fetchFundamentalData(ticker);
                 
                 let revGrowth = 0; let epsGrowth = 0; let margin = 0; let debt = 0; let fcf = 0;
                 let rawFcf = null; // declared at outer scope for FCF label use after if/else block
                 
                 if (fundRaw && fundRaw.quoteSummary && Array.isArray(fundRaw.quoteSummary.result) && fundRaw.quoteSummary.result.length > 0) {
                     const fData = fundRaw.quoteSummary.result[0].financialData || {};
                     const kData = fundRaw.quoteSummary.result[0].defaultKeyStatistics || {};
                     
                     // Revenue Growth
                     revGrowth = (fData.revenueGrowth && fData.revenueGrowth.raw !== undefined) ? fData.revenueGrowth.raw * 100 : 0;

                     // EPS Growth (YoY): Use forward EPS vs trailing EPS for the most accurate signal.
                     // earningsQuarterlyGrowth and earningsGrowth are often distorted by one-time items
                     // or base effects (e.g. a company that just turned profitable).
                     // Forward vs trailing EPS is the cleanest, unambiguous metric.
                     const trailingEps = (kData.trailingEps && kData.trailingEps.raw !== undefined) ? kData.trailingEps.raw : null;
                     const forwardEps  = (kData.forwardEps  && kData.forwardEps.raw  !== undefined) ? kData.forwardEps.raw  : null;
                     if (trailingEps !== null && forwardEps !== null && Math.abs(trailingEps) > 0.001) {
                         // Cap at ±300% to avoid extreme display values for near-zero trailing EPS
                         epsGrowth = Math.max(-300, Math.min(300, (forwardEps - trailingEps) / Math.abs(trailingEps) * 100));
                     } else {
                         // Fallback: earningsQuarterlyGrowth (YoY same-quarter comparison)
                         epsGrowth = (kData.earningsQuarterlyGrowth && kData.earningsQuarterlyGrowth.raw !== undefined)
                             ? kData.earningsQuarterlyGrowth.raw * 100 : 0;
                     }

                     // Operating Margin
                     margin = (fData.operatingMargins && fData.operatingMargins.raw !== undefined) ? fData.operatingMargins.raw * 100 : 0;

                     // Debt/Equity: Yahoo returns as % for most stocks (AAPL: 102.63 → /100 = 1.03x ratio).
                     // But banks return the actual leverage ratio directly (SOFI: 18.487 = 18.5x leverage).
                     // Heuristic: raw > 10 means it's already a ratio; don't divide.
                     if (fData.debtToEquity && fData.debtToEquity.raw !== undefined) {
                         const rawDE = fData.debtToEquity.raw;
                         debt = rawDE > 10 ? rawDE : rawDE / 100;
                     } else {
                         debt = 0; // Default if no debtToEquity data
                     }

                     // FreeCashflow: banks don't report FCF — fall back to net income as proxy.
                     rawFcf = (fData.freeCashflow && fData.freeCashflow.raw !== undefined) ? fData.freeCashflow.raw : null;
                     const rawNI = (kData.netIncomeToCommon && kData.netIncomeToCommon.raw !== undefined) ? kData.netIncomeToCommon.raw : null;
                     if (rawFcf !== null) {
                         fcf = rawFcf / 1000000;
                     } else if (rawNI !== null) {
                         fcf = rawNI / 1000000; // net income proxy for banks/financials
                     } else {
                         fcf = 0; // Default if no FCF or Net Income data
                     }
                 } else {
                     // Fallback to deterministic simulated data if the API fails entirely for this ticker
                     let seedCharHash = 0;
                     for (let i = 0; i < ticker.length; i++) {
                         seedCharHash += ticker.charCodeAt(i) * (i+1);
                     }
                     const seed = seedCharHash * 1000 + (data.history.length * 7); 
                     
                     revGrowth = ((seed % 50) - 5) * (isBullish ? 1 : 0.4); 
                     epsGrowth = ((seed % 80) - 15) * (isBullish ? 1.2 : 0.5); 
                     margin = 8 + (seed % 27); 
                     debt = 0.05 + ((seed % 150) / 100); 
                     fcf = (seed % 14900) + 100;
                 }
                 
                 // Apply specific overrides requested by user regardless of API/simulation origin
                 if (ticker === 'PTR') {
                     margin = 40.2;
                     revGrowth = 12.5;
                     epsGrowth = 22.4;
                     debt = 0.35;
                     fcf = 18500;
                 }

                 const isRevGood = revGrowth > 5;
                 const isEpsGood = epsGrowth > 10;
                 const isMarginGood = margin > 15;
                 // Banks carry high leverage by design (10-30x is normal). Use sector-aware threshold.
                 // For banks (debt > 10): healthy range is 5-30x leverage.
                 // For regular stocks (debt <= 1): healthy is < 1.0x ratio.
                 const isBank = debt > 10;
                 const isDebtGood = isBank ? (debt >= 5 && debt <= 30) : (debt > 0 && debt < 1.0);
                 const debtLabel = isBank ? `${debt.toFixed(1)}x leverage` : debt.toFixed(2);
                 const isFcfGood = fcf > 100; // lowered threshold: smaller companies or banks may have $100M+ net income

                 const healthScore = [isRevGood, isEpsGood, isMarginGood, isDebtGood, isFcfGood].filter(Boolean).length;

                 const setMetric = (idPrefix, valStr, isGood, trendStr) => {
                     document.getElementById(`${idPrefix}-val`).textContent = valStr;
                     document.getElementById(`${idPrefix}-val`).className = isGood ? 'neon-green' : 'neon-red';
                     document.getElementById(`${idPrefix}-trend`).textContent = trendStr;
                     document.getElementById(`${idPrefix}-trend`).style.color = isGood ? 'var(--neon-green)' : 'var(--neon-red)';
                 };

                 setMetric('h-rev', `${revGrowth > 0 ? '+' : ''}${revGrowth.toFixed(1)}%`, isRevGood, isRevGood ? 'Accelerating ▼ Costs' : 'Decelerating');
                 setMetric('h-eps', `${epsGrowth > 0 ? '+' : ''}${epsGrowth.toFixed(1)}%`, isEpsGood, isEpsGood ? 'Outperforming Estimates' : 'Missing Estimates');
                 setMetric('h-margin', `${margin.toFixed(1)}%`, isMarginGood, isMarginGood ? 'Expanding' : 'Contracting');
                 setMetric('h-debt', debtLabel, isDebtGood, isDebtGood ? (isBank ? 'Within Normal Bank Leverage' : 'Deleveraging') : (isBank ? 'High Leverage Risk' : 'Accumulating Debt'));
                 setMetric('h-fcf', `$${fcf.toFixed(0)}M`, isFcfGood, isFcfGood ? (rawFcf !== null ? 'Generating Cash' : 'Net Income Positive') : (rawFcf !== null ? 'Burning Cash' : 'Net Loss'));

                 const verdictEl = document.getElementById('h-verdict-val');
                 if (healthScore >= 4) {
                     verdictEl.textContent = 'STRONG BUY';
                     verdictEl.className = 'neon-green';
                     verdictEl.parentElement.style.borderColor = 'var(--neon-green)';
                     verdictEl.parentElement.style.boxShadow = 'inset 0 0 10px rgba(57,255,20,0.1)';
                 } else if (healthScore >= 2) {
                     verdictEl.textContent = 'HOLD / NEUTRAL';
                     verdictEl.className = 'neon-cyan';
                     verdictEl.parentElement.style.borderColor = 'var(--neon-cyan)';
                     verdictEl.parentElement.style.boxShadow = 'inset 0 0 10px rgba(0,240,255,0.1)';
                 } else {
                     verdictEl.textContent = 'HIGH RISK';
                     verdictEl.className = 'neon-red';
                     verdictEl.parentElement.style.borderColor = 'var(--neon-red)';
                     verdictEl.parentElement.style.boxShadow = 'inset 0 0 10px rgba(255,7,58,0.1)';
                 }
            }

            // Dynamically Draw SVG Paths for all 3 charts + Legacy pattern based on historical data array
            drawDynamicChart('gann-chart', visibleHistory, 'gann');
            drawDynamicChart('hurst-chart', visibleHistory, 'hurst');
            drawDynamicChart('elliott-chart', visibleHistory, 'elliott');
            drawDynamicChart('legacy-chart', visibleHistory, 'legacy');

            // Re-attach pan listeners to refreshed SVGs
            document.querySelectorAll('.chart-container').forEach(c => {
                const svg = c.querySelector('svg');
                if (svg) delete svg.dataset.panInited; // force re-init
                initPan(c);
            });
            
            // Re-select the SVGs to update specific pattern text nodes after re-drawing
            const updatedPatTitle = document.getElementById('pattern-title-text-svg');
            if (updatedPatTitle) {
                const rawText = updatedPatTitle.getAttribute('data-raw-text') || 'PATTERN DETECTED';
                updatedPatTitle.textContent = `${ticker} ${rawText}`;
            }

            // Provide a static redraw over legacy tab container as backup mapping 
            const patTitleList = document.querySelectorAll('.pattern-title-txt');
            patTitleList.forEach(p => {
                const rawText = p.getAttribute('data-raw-text') || 'PATTERN DETECTED';
                p.textContent = `${ticker} ${rawText} Focus`;
            });

            // Prepend new data to Ribbon Ticker
            const newItem = document.createElement('div');
            newItem.className = 'ticker-item';
            newItem.innerHTML = `<span>${ticker}</span> LATEST: <span class="${colorClass}">$${data.price} (${sign}${data.changePercent}%)</span>`;
            
            const divider = document.createElement('div');
            divider.className = 'ticker-devider';
            divider.innerText = '|';

            liveTickerTrack.insertBefore(divider, liveTickerTrack.firstChild);
            liveTickerTrack.insertBefore(newItem, liveTickerTrack.firstChild);

            const statusIndicator = document.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.classList.remove('offline');
                statusIndicator.classList.add('online');
                // Pulse effect
                statusIndicator.style.opacity = '1';
                setTimeout(() => statusIndicator.style.opacity = '0.7', 500);
            }

        } catch (error) {
            console.error(error);
            const statusIndicator = document.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.classList.remove('online');
                statusIndicator.classList.add('offline');
            }
            // Only alert on the first explicit search, not on background updates
            if (isSilentUpdate !== true) {
                alert(error.message);
                newsFeed.innerHTML = `<div class="news-item"><span class="neon-red">Error:</span> ${error.message}</div>`;
            }
        }
    };

    const handleSearchClick = () => {
        zoomDomain = null; // Reset zoom on new manual search
        handleSearch(false);
        
        // Start live data polling interval
        if (liveDataInterval) clearInterval(liveDataInterval);
        liveDataInterval = setInterval(() => {
            if (activeTickerStr) {
                handleSearch(true); // silent update
            }
        }, 15000); // Poll every 15 seconds
    };

    searchBtn.addEventListener('click', handleSearchClick);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchClick();
    });

    const searchWrapper = document.querySelector('.ribbon-search');
    const tickerListUI = document.getElementById('custom-ticker-list');
    let allTickers = [];

    // Populate data list for autocomplete
    const populateTickers = async () => {
        try {
            const res = await fetch('tickers.txt');
            if (res.ok) {
                const text = await res.text();
                allTickers = text.split('\\n').filter(t => t.trim() !== '');
            }
        } catch (e) {
            console.log("Could not load tickers.txt", e);
        }
    };
    populateTickers();

    searchInput.addEventListener('input', (e) => {
         const val = e.target.value.toUpperCase();
         if (!val) {
             tickerListUI.classList.remove('active');
             return;
         }
         const matches = allTickers.filter(t => t.startsWith(val)).slice(0, 10);
         if (matches.length > 0) {
             tickerListUI.innerHTML = matches.map(t => `<li data-ticker="${t}">${t}</li>`).join('');
             tickerListUI.classList.add('active');
         } else {
             tickerListUI.classList.remove('active');
         }
    });

    tickerListUI.addEventListener('click', (e) => {
         if (e.target.tagName === 'LI') {
             searchInput.value = e.target.getAttribute('data-ticker');
             tickerListUI.classList.remove('active');
             handleSearchClick();
         }
    });

    document.addEventListener('click', (e) => {
         if (!searchWrapper.contains(e.target)) {
              tickerListUI.classList.remove('active');
         }
    });

    // 4. Zoom & Pan Logic (Mouse Wheel + Drag Panning + Click Expand)
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartDomain = null;

    const refreshAllCharts = () => {
        if (!activeHistoryData || !zoomDomain) return;
        const visibleHistory = activeHistoryData.slice(zoomDomain[0], zoomDomain[1] + 1);
        
        // Update all standard panels
        ['gann-chart', 'hurst-chart', 'elliott-chart', 'legacy-chart'].forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                const type = container.getAttribute('data-engine') || 'legacy';
                drawDynamicChart(id, visibleHistory, type);
                
                if (type === 'legacy') {
                    const p = recognizePattern(visibleHistory);
                    const textEl = container.querySelector('.pattern-title-txt');
                    if (textEl) textEl.textContent = `${activeTickerStr} ${p.text} Focus`;
                }
            }
        });

        // Update modal if open
        const modalChart = document.getElementById('modal-expanded-chart');
        if (modalChart) {
            const type = modalChart.getAttribute('data-engine') || 'legacy';
            drawDynamicChart('modal-expanded-chart', visibleHistory, type);
            
            if (type === 'elliott') {
                const prices = visibleHistory.map(d => d.price);
                const w5y = Math.max(...prices) * 1.05;
                const clonedTargetPrice = document.querySelector('#modal-expanded-chart #elliott-target-price');
                if (clonedTargetPrice) clonedTargetPrice.textContent = `$${(w5y*0.98).toFixed(2)} - $${(w5y*1.05).toFixed(2)}`;
            } else if (type === 'legacy') {
                const p = recognizePattern(visibleHistory);
                const updatedPatTitle = document.querySelector('#modal-expanded-chart #pattern-title-text-svg');
                if (updatedPatTitle) {
                    const rawText = updatedPatTitle.getAttribute('data-raw-text') || p.text;
                    updatedPatTitle.textContent = `${activeTickerStr} ${rawText}`;
                }
            }
        }
        
        renderChartAxes(activeTickerStr, visibleHistory[visibleHistory.length-1].price, visibleHistory);
    };

    // Use Event Delegation for zooming and panning so it applies to dynamically cloned Modal charts as well
    document.addEventListener('wheel', (e) => {
        const container = e.target.closest('.chart-container, #modal-expanded-chart');
        if (!container || !activeHistoryData || !zoomDomain) return;
        e.preventDefault();

        const zoomSpeed = 0.05;
        const historyLen = activeHistoryData.length;
        const currentSize = zoomDomain[1] - zoomDomain[0];
        
        let zoomDelta = Math.floor(currentSize * zoomSpeed);
        if (zoomDelta < 2) zoomDelta = 2;

        let newStart = zoomDomain[0];
        let newEnd = zoomDomain[1];

        if (e.deltaY < 0) {
            newStart += zoomDelta;
            newEnd -= zoomDelta;
        } else {
            newStart -= zoomDelta;
            newEnd += zoomDelta;
        }

        const minWindowSize = 20;
        if (newEnd - newStart < minWindowSize) {
            const center = Math.floor((newStart + newEnd) / 2);
            newStart = center - Math.floor(minWindowSize/2);
            newEnd = center + Math.floor(minWindowSize/2);
        }

        if (newStart < 0) newStart = 0;
        if (newEnd > historyLen - 1) newEnd = historyLen - 1;
        
        if (newEnd - newStart < currentSize && e.deltaY > 0) {
           if (newStart === 0) newEnd = Math.min(historyLen - 1, newStart + currentSize + zoomDelta*2);
           if (newEnd === historyLen - 1) newStart = Math.max(0, newEnd - currentSize - zoomDelta*2);
        }

        zoomDomain = [newStart, newEnd];
        refreshAllCharts();
    }, { passive: false });

    document.addEventListener('mousedown', (e) => {
        const container = e.target.closest('.chart-container, #modal-expanded-chart');
        if (!container || !activeHistoryData || !zoomDomain) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartDomain = [...zoomDomain];
        container.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !activeHistoryData || !zoomDomain || !dragStartDomain) return;
        const container = e.target.closest('.chart-container, #modal-expanded-chart') || document.querySelector('.chart-container.active') || document.querySelector('.chart-container');
        if(!container) return;
        
        const dx = e.clientX - dragStartX;
        if (Math.abs(dx) < 5) return;

        const containerWidth = container.clientWidth || 800;
        const historyLen = activeHistoryData.length;
        const currentSize = dragStartDomain[1] - dragStartDomain[0];
        
        const candlesToPan = Math.round((dx / containerWidth) * currentSize * 1.5);
        
        let newStart = dragStartDomain[0] - candlesToPan;
        let newEnd = dragStartDomain[1] - candlesToPan;
        
        if (newStart < 0) {
            newEnd = Math.min(newEnd - newStart, historyLen - 1);
            newStart = 0;
        }
        if (newEnd > historyLen - 1) {
            newStart = Math.max(0, newStart - (newEnd - (historyLen - 1)));
            newEnd = historyLen - 1;
        }
        
        zoomDomain = [newStart, newEnd];
        refreshAllCharts();
    });

    const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        document.querySelectorAll('.chart-container, #modal-expanded-chart').forEach(c => c.style.cursor = 'default');

        if (e && e.type === 'mouseup') {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
                const container = e.target.closest('.chart-container');
                if (container && container.id !== 'modal-expanded-chart') {
                    openChartModal(container);
                }
            }
        }
    };

    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('mouseleave', stopDrag);

    // 5. Manual Zoom Button Logic
    const zoomInBtns = document.querySelectorAll('.btn-zoom-in');
    const zoomOutBtns = document.querySelectorAll('.btn-zoom-out');

    const handleManualZoom = (direction) => {
        if (!activeHistoryData || !zoomDomain) return;
        
        const zoomSpeed = 0.15; // 15% per click for faster manual zooming
        const historyLen = activeHistoryData.length;
        const currentSize = zoomDomain[1] - zoomDomain[0];
        
        let zoomDelta = Math.floor(currentSize * zoomSpeed);
        if (zoomDelta < 2) zoomDelta = 2;

        let newStart = zoomDomain[0];
        let newEnd = zoomDomain[1];

        if (direction === 'in') {
            newStart += zoomDelta;
            newEnd -= zoomDelta;
        } else {
            newStart -= zoomDelta;
            newEnd += zoomDelta;
        }

        const minWindowSize = 20;
        if (newEnd - newStart < minWindowSize) {
            const center = Math.floor((newStart + newEnd) / 2);
            newStart = center - Math.floor(minWindowSize/2);
            newEnd = center + Math.floor(minWindowSize/2);
        }

        if (newStart < 0) newStart = 0;
        if (newEnd > historyLen - 1) newEnd = historyLen - 1;

        if (newEnd - newStart < currentSize && direction === 'out') {
            if (newStart === 0) newEnd = Math.min(historyLen - 1, newStart + currentSize + zoomDelta*2);
            if (newEnd === historyLen - 1) newStart = Math.max(0, newEnd - currentSize - zoomDelta*2);
        }

        zoomDomain = [newStart, newEnd];
        refreshAllCharts();
    };

    zoomInBtns.forEach(btn => btn.addEventListener('click', () => handleManualZoom('in')));
    zoomOutBtns.forEach(btn => btn.addEventListener('click', () => handleManualZoom('out')));

    // Start background simulation streams
    startSocialSentimentStream();
    startLiveAlertsStream();

});
