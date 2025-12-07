import React, { useState, useEffect, useMemo, useRef } from 'react';

// ============ CHART COMPONENT ============
const Chart = ({ interval = '1m', symbol = 'SOLUSDT' }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    let ws;
    const init = async () => {
      const { createChart } = await import('https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.mjs');
      if (!containerRef.current) return;
      if (chartRef.current) chartRef.current.remove();

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 280,
        layout: { background: { color: '#0a0a0a' }, textColor: '#666' },
        grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: '#1a1a1a' },
        timeScale: { borderColor: '#1a1a1a', timeVisible: true, secondsVisible: true },
      });
      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444',
        borderDownColor: '#ef4444', borderUpColor: '#10b981',
        wickDownColor: '#ef4444', wickUpColor: '#10b981',
      });

      const ema5 = chart.addLineSeries({ color: '#10b981', lineWidth: 1 });
      const ema13 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });
      const vwap = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lineStyle: 2 });

      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`);
        const data = await res.json();
        const candles = data.map(d => ({ time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) }));
        candleSeries.setData(candles);

        const calcEMA = (data, period) => {
          const k = 2 / (period + 1); let ema = data[0].close;
          return data.map((d, i) => { if (i === 0) return { time: d.time, value: ema }; ema = d.close * k + ema * (1 - k); return { time: d.time, value: ema }; });
        };
        
        // VWAP calculation
        let cumVol = 0, cumPV = 0;
        const vwapData = candles.map(d => {
          const typical = (d.high + d.low + d.close) / 3;
          cumPV += typical * d.volume;
          cumVol += d.volume;
          return { time: d.time, value: cumVol > 0 ? cumPV / cumVol : typical };
        });
        
        ema5.setData(calcEMA(candles, 5));
        ema13.setData(calcEMA(candles, 13));
        vwap.setData(vwapData);
        chart.timeScale().fitContent();

        const wsSymbol = symbol.toLowerCase();
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${wsSymbol}@kline_${interval}`);
        ws.onmessage = (e) => {
          const k = JSON.parse(e.data).k;
          candleSeries.update({ time: k.t / 1000, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) });
        };
      } catch (err) { console.error(err); }

      const resize = () => chart?.applyOptions({ width: containerRef.current?.clientWidth });
      window.addEventListener('resize', resize);
      return () => { window.removeEventListener('resize', resize); };
    };
    init();
    return () => { ws?.close(); };
  }, [interval, symbol]);

  return <div ref={containerRef} style={{ width: '100%', height: '280px' }} />;
};

// ============ SCALPING INDICATORS ============
const calcEMA = (data, period) => {
  const k = 2 / (period + 1); let ema = data[0]?.close || 0;
  return data.map((d, i) => { if (i === 0) return ema; ema = d.close * k + ema * (1 - k); return ema; });
};

// Fast RSI for scalping (6 period)
const calcRSI = (data, period = 6) => {
  const changes = data.map((d, i) => i === 0 ? 0 : d.close - data[i - 1].close);
  const gains = changes.map(c => c > 0 ? c : 0), losses = changes.map(c => c < 0 ? -c : 0);
  let avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  return data.map((_, i) => {
    if (i < period) return 50;
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  });
};

const calcMACD = (data) => {
  const ema12 = calcEMA(data, 12), ema26 = calcEMA(data, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine.map(v => ({ close: v })), 9);
  return { macd: macdLine, signal, histogram: macdLine.map((v, i) => v - signal[i]) };
};

const calcATR = (data, period = 10) => {
  const tr = data.map((d, i) => i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - data[i-1].close), Math.abs(d.low - data[i-1].close)));
  return tr.map((_, i) => i < period ? tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
};

const calcVWAP = (data) => {
  let cumVol = 0, cumPV = 0;
  return data.map(d => {
    const typical = (d.high + d.low + d.close) / 3;
    cumPV += typical * d.volume;
    cumVol += d.volume;
    return cumVol > 0 ? cumPV / cumVol : typical;
  });
};

// Volume analysis for scalping
const analyzeVolume = (data, period = 10) => {
  if (data.length < period) return { relative: 1, delta: 0, spike: false, trend: 'neutral' };
  const recent = data.slice(-period);
  const avgVolume = recent.reduce((a, b) => a + b.volume, 0) / period;
  const currentVolume = data[data.length - 1].volume;
  const relative = currentVolume / avgVolume;
  
  // Volume delta (buying vs selling pressure)
  const current = data[data.length - 1];
  const range = current.high - current.low;
  const delta = range > 0 ? ((current.close - current.low) / range - 0.5) * 2 : 0; // -1 to 1
  
  // Recent volume trend
  const last3Vol = data.slice(-3).reduce((a, b) => a + b.volume, 0) / 3;
  const prev3Vol = data.slice(-6, -3).reduce((a, b) => a + b.volume, 0) / 3;
  const volTrend = last3Vol > prev3Vol * 1.2 ? 'increasing' : last3Vol < prev3Vol * 0.8 ? 'decreasing' : 'stable';
  
  return { relative, delta, spike: relative > 2.5, bigSpike: relative > 4, trend: volTrend, avgVolume, currentVolume };
};

// Candle pattern detection for scalping
const detectCandlePatterns = (data) => {
  if (data.length < 3) return { pattern: 'none', strength: 0 };
  
  const c0 = data[data.length - 1]; // Current
  const c1 = data[data.length - 2]; // Previous
  const c2 = data[data.length - 3]; // 2 candles ago
  
  const body0 = Math.abs(c0.close - c0.open);
  const body1 = Math.abs(c1.close - c1.open);
  const range0 = c0.high - c0.low;
  const range1 = c1.high - c1.low;
  
  const isBullish0 = c0.close > c0.open;
  const isBullish1 = c1.close > c1.open;
  
  // Bullish engulfing
  if (isBullish0 && !isBullish1 && c0.close > c1.open && c0.open < c1.close && body0 > body1 * 1.2) {
    return { pattern: 'bullish_engulfing', strength: 3, type: 'bullish' };
  }
  
  // Bearish engulfing
  if (!isBullish0 && isBullish1 && c0.close < c1.open && c0.open > c1.close && body0 > body1 * 1.2) {
    return { pattern: 'bearish_engulfing', strength: 3, type: 'bearish' };
  }
  
  // Bullish pin bar (hammer)
  const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
  const upperWick0 = c0.high - Math.max(c0.open, c0.close);
  if (lowerWick0 > body0 * 2 && upperWick0 < body0 * 0.5 && range0 > 0) {
    return { pattern: 'bullish_pin', strength: 2, type: 'bullish' };
  }
  
  // Bearish pin bar (shooting star)
  if (upperWick0 > body0 * 2 && lowerWick0 < body0 * 0.5 && range0 > 0) {
    return { pattern: 'bearish_pin', strength: 2, type: 'bearish' };
  }
  
  // Strong momentum candle
  if (isBullish0 && body0 > range0 * 0.7 && body0 > body1 * 1.5) {
    return { pattern: 'bullish_momentum', strength: 2, type: 'bullish' };
  }
  if (!isBullish0 && body0 > range0 * 0.7 && body0 > body1 * 1.5) {
    return { pattern: 'bearish_momentum', strength: 2, type: 'bearish' };
  }
  
  // Three white soldiers / black crows
  const isBullish2 = c2.close > c2.open;
  if (isBullish0 && isBullish1 && isBullish2 && c0.close > c1.close && c1.close > c2.close) {
    return { pattern: 'three_soldiers', strength: 3, type: 'bullish' };
  }
  if (!isBullish0 && !isBullish1 && !isBullish2 && c0.close < c1.close && c1.close < c2.close) {
    return { pattern: 'three_crows', strength: 3, type: 'bearish' };
  }
  
  return { pattern: 'none', strength: 0, type: 'neutral' };
};

// Momentum strength (rate of change)
const calcMomentum = (data, period = 5) => {
  if (data.length < period + 1) return 0;
  const current = data[data.length - 1].close;
  const past = data[data.length - period - 1].close;
  return ((current - past) / past) * 100;
};

// ============ SCALPING SIGNAL ANALYSIS ============
const analyzeScalpSignals = (data, funding = 0, refBias = 'NEUTRAL') => {
  if (data.length < 30) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null, score: 0, entryQuality: 'NONE', scalpReady: false };
  
  const latest = data[data.length - 1], prev = data[data.length - 2], prev2 = data[data.length - 3];
  
  // Fast EMAs for scalping
  const ema5 = calcEMA(data, 5), ema13 = calcEMA(data, 13), ema21 = calcEMA(data, 21);
  const rsi = calcRSI(data, 6); // Fast RSI
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const atr = calcATR(data, 10);
  const vwap = calcVWAP(data);
  const volume = analyzeVolume(data, 10);
  const candlePattern = detectCandlePatterns(data);
  const momentum = calcMomentum(data, 5);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { 
    momentum: { score: 0, max: 35, signals: [] }, 
    price_action: { score: 0, max: 30, signals: [] }, 
    volume: { score: 0, max: 25, signals: [] },
    context: { score: 0, max: 20, signals: [] }
  };
  
  const le5 = ema5[ema5.length - 1], le13 = ema13[ema13.length - 1], le21 = ema21[ema21.length - 1];
  const pe5 = ema5[ema5.length - 2], pe13 = ema13[ema13.length - 2];
  const lVWAP = vwap[vwap.length - 1];
  const lRSI = rsi[rsi.length - 1], pRSI = rsi[rsi.length - 2];
  const lMACD = macd[macd.length - 1], lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1], pHist = histogram[histogram.length - 2];
  const lATR = atr[atr.length - 1];
  
  // ============ MOMENTUM (35 pts) ============
  // EMA alignment (fast)
  if (le5 > le13 && le13 > le21) { bullScore += 10; breakdown.momentum.score += 10; breakdown.momentum.signals.push({ type: 'bullish', text: 'EMAs stacked ↑' }); }
  else if (le5 < le13 && le13 < le21) { bearScore += 10; breakdown.momentum.score -= 10; breakdown.momentum.signals.push({ type: 'bearish', text: 'EMAs stacked ↓' }); }
  
  // EMA cross (high value for scalping)
  if (pe5 <= pe13 && le5 > le13) { bullScore += 12; breakdown.momentum.score += 12; breakdown.momentum.signals.push({ type: 'bullish', text: '⚡ EMA5/13 cross UP' }); }
  if (pe5 >= pe13 && le5 < le13) { bearScore += 12; breakdown.momentum.score -= 12; breakdown.momentum.signals.push({ type: 'bearish', text: '⚡ EMA5/13 cross DOWN' }); }
  
  // RSI momentum
  if (lRSI < 25) { bullScore += 8; breakdown.momentum.score += 8; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold ${lRSI.toFixed(0)}` }); }
  else if (lRSI > 75) { bearScore += 8; breakdown.momentum.score -= 8; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought ${lRSI.toFixed(0)}` }); }
  else if (lRSI > 55 && lRSI > pRSI) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'RSI rising' }); }
  else if (lRSI < 45 && lRSI < pRSI) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'RSI falling' }); }
  
  // MACD histogram momentum
  if (lHist > 0 && lHist > pHist * 1.2) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD accel ↑' }); }
  else if (lHist < 0 && lHist < pHist * 1.2) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD accel ↓' }); }
  
  // Rate of change
  if (momentum > 0.3) { bullScore += 5; breakdown.momentum.score += 5; breakdown.momentum.signals.push({ type: 'bullish', text: `Mom +${momentum.toFixed(2)}%` }); }
  else if (momentum < -0.3) { bearScore += 5; breakdown.momentum.score -= 5; breakdown.momentum.signals.push({ type: 'bearish', text: `Mom ${momentum.toFixed(2)}%` }); }
  
  // ============ PRICE ACTION (30 pts) ============
  // Candle patterns (crucial for scalping)
  if (candlePattern.type === 'bullish') {
    const pts = candlePattern.strength * 5;
    bullScore += pts;
    breakdown.price_action.score += pts;
    breakdown.price_action.signals.push({ type: 'bullish', text: `🔥 ${candlePattern.pattern.replace('_', ' ')}` });
  } else if (candlePattern.type === 'bearish') {
    const pts = candlePattern.strength * 5;
    bearScore += pts;
    breakdown.price_action.score -= pts;
    breakdown.price_action.signals.push({ type: 'bearish', text: `🔥 ${candlePattern.pattern.replace('_', ' ')}` });
  }
  
  // Price vs VWAP
  if (latest.close > lVWAP && latest.low > lVWAP) { bullScore += 6; breakdown.price_action.score += 6; breakdown.price_action.signals.push({ type: 'bullish', text: 'Above VWAP' }); }
  else if (latest.close < lVWAP && latest.high < lVWAP) { bearScore += 6; breakdown.price_action.score -= 6; breakdown.price_action.signals.push({ type: 'bearish', text: 'Below VWAP' }); }
  
  // Price vs fast EMA
  if (latest.close > le5 && latest.low >= le5) { bullScore += 4; breakdown.price_action.score += 4; breakdown.price_action.signals.push({ type: 'bullish', text: 'Riding EMA5' }); }
  else if (latest.close < le5 && latest.high <= le5) { bearScore += 4; breakdown.price_action.score -= 4; breakdown.price_action.signals.push({ type: 'bearish', text: 'Under EMA5' }); }
  
  // Break of recent high/low
  const last10High = Math.max(...data.slice(-10).map(d => d.high));
  const last10Low = Math.min(...data.slice(-10).map(d => d.low));
  if (latest.close > last10High && latest.close > prev.high) { bullScore += 8; breakdown.price_action.score += 8; breakdown.price_action.signals.push({ type: 'bullish', text: '⚡ Break HIGH' }); }
  if (latest.close < last10Low && latest.close < prev.low) { bearScore += 8; breakdown.price_action.score -= 8; breakdown.price_action.signals.push({ type: 'bearish', text: '⚡ Break LOW' }); }
  
  // ============ VOLUME (25 pts) ============
  // Volume spike (key scalping trigger)
  if (volume.bigSpike) {
    if (latest.close > prev.close) { bullScore += 15; breakdown.volume.score += 15; breakdown.volume.signals.push({ type: 'bullish', text: `🚀 VOL SPIKE ${volume.relative.toFixed(1)}x` }); }
    else { bearScore += 15; breakdown.volume.score -= 15; breakdown.volume.signals.push({ type: 'bearish', text: `🚀 VOL SPIKE ${volume.relative.toFixed(1)}x` }); }
  } else if (volume.spike) {
    if (latest.close > prev.close) { bullScore += 10; breakdown.volume.score += 10; breakdown.volume.signals.push({ type: 'bullish', text: `Vol spike ${volume.relative.toFixed(1)}x` }); }
    else { bearScore += 10; breakdown.volume.score -= 10; breakdown.volume.signals.push({ type: 'bearish', text: `Vol spike ${volume.relative.toFixed(1)}x` }); }
  } else if (volume.relative > 1.5) {
    if (latest.close > prev.close) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'Good volume' }); }
    else { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'Good volume' }); }
  }
  
  // Volume delta (buying/selling pressure)
  if (volume.delta > 0.5) { bullScore += 6; breakdown.volume.score += 6; breakdown.volume.signals.push({ type: 'bullish', text: 'Buy pressure' }); }
  else if (volume.delta < -0.5) { bearScore += 6; breakdown.volume.score -= 6; breakdown.volume.signals.push({ type: 'bearish', text: 'Sell pressure' }); }
  
  // Volume trend
  if (volume.trend === 'increasing') { breakdown.volume.signals.push({ type: 'neutral', text: 'Vol increasing' }); }
  
  // ============ CONTEXT (20 pts) ============
  // Reference asset alignment
  if (refBias === 'LONG') { bullScore += 8; breakdown.context.score += 8; breakdown.context.signals.push({ type: 'bullish', text: 'Ref bullish ✓' }); }
  else if (refBias === 'SHORT') { bearScore += 8; breakdown.context.score -= 8; breakdown.context.signals.push({ type: 'bearish', text: 'Ref bearish ✓' }); }
  
  // Funding
  const fundingPct = funding * 100;
  if (fundingPct > 0.05) { bearScore += 6; breakdown.context.score -= 6; breakdown.context.signals.push({ type: 'bearish', text: 'High funding' }); }
  else if (fundingPct < -0.05) { bullScore += 6; breakdown.context.score += 6; breakdown.context.signals.push({ type: 'bullish', text: 'Neg funding' }); }
  
  // Not trading into resistance/support
  if (latest.close > last10High * 0.998 && latest.close < last10High * 1.002) {
    breakdown.context.signals.push({ type: 'neutral', text: 'At resistance' });
  }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  
  let bias = 'NEUTRAL'; 
  if (totalScore >= 12) bias = 'LONG'; 
  else if (totalScore <= -12) bias = 'SHORT';
  
  // ============ SCALP ENTRY QUALITY ============
  let entryQuality = 'NONE';
  let qualityReasons = [];
  let scalpReady = false;
  
  if (bias !== 'NEUTRAL') {
    let qualityScore = 0;
    
    if (bias === 'LONG') {
      if (candlePattern.type === 'bullish') { qualityScore += 3; qualityReasons.push(candlePattern.pattern.replace('_', ' ')); }
      if (volume.relative >= 2) { qualityScore += 2; qualityReasons.push('Volume spike'); }
      if (volume.delta > 0.3) { qualityScore += 1; qualityReasons.push('Buy pressure'); }
      if (le5 > le13) { qualityScore += 1; qualityReasons.push('EMA aligned'); }
      if (latest.close > lVWAP) { qualityScore += 1; qualityReasons.push('Above VWAP'); }
      if (lRSI > 50 && lRSI < 70) { qualityScore += 1; qualityReasons.push('RSI OK'); }
      if (refBias === 'LONG') { qualityScore += 2; qualityReasons.push('Ref aligned'); }
      if (momentum > 0.2) { qualityScore += 1; qualityReasons.push('Momentum'); }
      if (latest.close > prev.close && prev.close > prev2.close) { qualityScore += 1; qualityReasons.push('3 green'); }
    } else {
      if (candlePattern.type === 'bearish') { qualityScore += 3; qualityReasons.push(candlePattern.pattern.replace('_', ' ')); }
      if (volume.relative >= 2) { qualityScore += 2; qualityReasons.push('Volume spike'); }
      if (volume.delta < -0.3) { qualityScore += 1; qualityReasons.push('Sell pressure'); }
      if (le5 < le13) { qualityScore += 1; qualityReasons.push('EMA aligned'); }
      if (latest.close < lVWAP) { qualityScore += 1; qualityReasons.push('Below VWAP'); }
      if (lRSI < 50 && lRSI > 30) { qualityScore += 1; qualityReasons.push('RSI OK'); }
      if (refBias === 'SHORT') { qualityScore += 2; qualityReasons.push('Ref aligned'); }
      if (momentum < -0.2) { qualityScore += 1; qualityReasons.push('Momentum'); }
      if (latest.close < prev.close && prev.close < prev2.close) { qualityScore += 1; qualityReasons.push('3 red'); }
    }
    
    if (qualityScore >= 8) { entryQuality = 'A+'; scalpReady = true; }
    else if (qualityScore >= 6) { entryQuality = 'A'; scalpReady = true; }
    else if (qualityScore >= 4) entryQuality = 'B';
    else if (qualityScore >= 2) entryQuality = 'C';
  }
  
  // Trade filters for scalping
  let shouldTrade = scalpReady;
  let noTradeReason = '';
  if (volume.relative < 0.8) { shouldTrade = false; noTradeReason = 'Volume too low'; }
  if (lATR < latest.close * 0.0005) { shouldTrade = false; noTradeReason = 'Volatility too low'; }
  if (Math.abs(totalScore) < 15 && !volume.spike) { shouldTrade = false; noTradeReason = 'Weak signal'; }
  
  // ============ SCALP TRADE PLAN ============
  let tradePlan = null;
  if (bias !== 'NEUTRAL') {
    const price = latest.close;
    
    if (bias === 'LONG') {
      const entry = price;
      const stopLoss = Math.max(latest.low - lATR * 0.5, le13 - lATR * 0.3);
      const risk = entry - stopLoss;
      tradePlan = {
        direction: 'LONG',
        entry: entry,
        stopLoss,
        tp1: entry + risk * 1.0,  // 1R
        tp2: entry + risk * 1.5,  // 1.5R
        tp3: entry + risk * 2.0,  // 2R (runner)
        breakeven: entry + risk * 0.5, // Move to BE after 0.5R
        riskPercent: ((risk / entry) * 100).toFixed(3),
        atr: lATR,
        maxHold: '10-15 min'
      };
    } else {
      const entry = price;
      const stopLoss = Math.min(latest.high + lATR * 0.5, le13 + lATR * 0.3);
      const risk = stopLoss - entry;
      tradePlan = {
        direction: 'SHORT',
        entry: entry,
        stopLoss,
        tp1: entry - risk * 1.0,
        tp2: entry - risk * 1.5,
        tp3: entry - risk * 2.0,
        breakeven: entry - risk * 0.5,
        riskPercent: ((risk / entry) * 100).toFixed(3),
        atr: lATR,
        maxHold: '10-15 min'
      };
    }
  }
  
  return { 
    bias, confidence: Math.min(Math.abs(totalScore) * 2, 100).toFixed(0), 
    bullScore, bearScore, signals, breakdown, shouldTrade, noTradeReason, tradePlan, score: totalScore,
    volume, candlePattern, entryQuality, qualityReasons, scalpReady, momentum,
    indicators: { rsi: lRSI, macd: lMACD, macdSignal: lSig, atr: lATR, vwap: lVWAP, ema5: le5, ema13: le13, price: latest.close } 
  };
};

// ============ SCALPING BACKTEST ============
const runScalpBacktest = (data, initialCapital = 10000) => {
  if (data.length < 100) return null;
  
  const trades = [];
  let position = null;
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  let skippedTrades = 0;
  
  for (let i = 30; i < data.length - 1; i++) {
    const slice = data.slice(0, i + 1);
    const analysis = analyzeScalpSignals(slice, 0, 'NEUTRAL');
    const currentCandle = data[i];
    const nextCandle = data[i + 1];
    
    // Exit logic (SCALP - fast exits)
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'LONG') {
        // Stop loss
        if (nextCandle.low <= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = 'Stop'; 
        }
        // TP2 (main target for scalp)
        else if (nextCandle.high >= position.tp2) { 
          exitPrice = position.tp2; 
          exitReason = 'TP2'; 
        }
        // TP1 hit - move to breakeven
        else if (nextCandle.high >= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true; 
          position.stopLoss = position.entry + (position.entry - position.originalStop) * 0.1; // Small profit lock
        }
        // Momentum reversal exit
        else if (analysis.bias === 'SHORT' && analysis.score <= -15) { 
          exitPrice = nextCandle.open; 
          exitReason = 'Reversal'; 
        }
        // EMA cross against
        else if (analysis.indicators.ema5 < analysis.indicators.ema13 && position.tp1Hit) {
          exitPrice = nextCandle.open;
          exitReason = 'EMA flip';
        }
      } else { // SHORT
        if (nextCandle.high >= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = 'Stop'; 
        }
        else if (nextCandle.low <= position.tp2) { 
          exitPrice = position.tp2; 
          exitReason = 'TP2'; 
        }
        else if (nextCandle.low <= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true; 
          position.stopLoss = position.entry - (position.originalStop - position.entry) * 0.1;
        }
        else if (analysis.bias === 'LONG' && analysis.score >= 15) { 
          exitPrice = nextCandle.open; 
          exitReason = 'Reversal'; 
        }
        else if (analysis.indicators.ema5 > analysis.indicators.ema13 && position.tp1Hit) {
          exitPrice = nextCandle.open;
          exitReason = 'EMA flip';
        }
      }
      
      // Time-based exit (max 15 candles = 15 min on 1m)
      if (!exitPrice && i - position.entryIndex >= 15) { 
        exitPrice = nextCandle.close; 
        exitReason = 'Time'; 
      }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' 
          ? (exitPrice - position.entry) * position.size 
          : (position.entry - exitPrice) * position.size;
        const riskAmount = Math.abs(position.entry - position.originalStop) * position.size;
        const rMultiple = pnl / riskAmount;
        capital += pnl;
        maxCapital = Math.max(maxCapital, capital);
        maxDrawdown = Math.max(maxDrawdown, ((maxCapital - capital) / maxCapital) * 100);
        trades.push({ 
          direction: position.direction, 
          entry: position.entry, 
          exit: exitPrice, 
          pnl, 
          pnlPercent: rMultiple, 
          reason: exitReason, 
          duration: i - position.entryIndex,
          quality: position.quality 
        });
        position = null;
      }
    }
    
    // Entry logic (SCALP - need strong signals)
    if (!position && analysis.tradePlan && analysis.scalpReady) {
      const validEntry = 
        analysis.shouldTrade &&
        Math.abs(analysis.score) >= 15 &&
        (analysis.entryQuality === 'A+' || analysis.entryQuality === 'A') &&
        analysis.volume.relative >= 1.2;
      
      // Candle confirmation
      const candleConfirm = analysis.bias === 'LONG' 
        ? (currentCandle.close > currentCandle.open) 
        : (currentCandle.close < currentCandle.open);
      
      if (validEntry && candleConfirm) {
        const plan = analysis.tradePlan;
        const riskPerTrade = capital * 0.005; // 0.5% risk for scalping
        const stopDistance = Math.abs(currentCandle.close - plan.stopLoss);
        const positionSize = riskPerTrade / stopDistance;
        
        position = {
          direction: plan.direction,
          entry: currentCandle.close,
          stopLoss: plan.stopLoss,
          originalStop: plan.stopLoss,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp1Hit: false,
          entryIndex: i,
          size: positionSize,
          quality: analysis.entryQuality
        };
      } else if (Math.abs(analysis.score) >= 12) {
        skippedTrades++;
      }
    }
  }
  
  // Close any open position
  if (position) {
    const lastPrice = data[data.length - 1].close;
    const pnl = position.direction === 'LONG' 
      ? (lastPrice - position.entry) * position.size 
      : (position.entry - lastPrice) * position.size;
    const riskAmount = Math.abs(position.entry - position.originalStop) * position.size;
    trades.push({ 
      direction: position.direction, 
      entry: position.entry, 
      exit: lastPrice, 
      pnl, 
      pnlPercent: pnl / riskAmount, 
      reason: 'End',
      duration: data.length - position.entryIndex,
      quality: position.quality 
    });
    capital += pnl;
  }
  
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const avgDuration = trades.length > 0 ? (trades.reduce((a, t) => a + t.duration, 0) / trades.length).toFixed(1) : 0;
  
  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    skippedTrades,
    winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: wins.length > 0 ? (wins.reduce((a, t) => a + t.pnlPercent, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length > 0 ? (losses.reduce((a, t) => a + t.pnlPercent, 0) / losses.length).toFixed(2) : 0,
    totalPnL: ((capital - initialCapital) / initialCapital * 100).toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : trades.length > 0 ? '∞' : '0',
    expectancy: trades.length > 0 ? (trades.reduce((a, t) => a + t.pnlPercent, 0) / trades.length).toFixed(2) : 0,
    avgDuration,
    trades: trades.slice(-20)
  };
};

// ============ UI COMPONENTS ============
const Badge = ({ label, value, status }) => {
  const c = { bullish: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' }, bearish: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444' }, neutral: { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' } }[status] || { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' };
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '4px 6px' }}><span style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '11px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

const StatBox = ({ label, value, color = '#fff', highlight = false }) => (
  <div style={{ background: highlight ? 'rgba(16,185,129,0.1)' : '#0a0a0a', border: `1px solid ${highlight ? '#10b981' : '#1a1a1a'}`, padding: '6px', textAlign: 'center' }}>
    <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px' }}>{label}</div>
    <div style={{ fontSize: '13px', fontWeight: '600', color }}>{value}</div>
  </div>
);

const SignalBox = ({ analysis, timeframe }) => (
  <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '8px', textAlign: 'center' }}>
    <div style={{ fontSize: '8px', color: '#888', letterSpacing: '1px', marginBottom: '2px' }}>{timeframe}</div>
    <div style={{ fontSize: '28px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis.bias}</div>
    <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>{analysis.score > 0 ? '+' : ''}{analysis.score} pts</div>
    {analysis.scalpReady && (
      <div style={{ marginTop: '4px', background: analysis.entryQuality === 'A+' ? '#10b981' : '#3b82f6', color: '#000', padding: '3px 8px', fontSize: '10px', fontWeight: '700', display: 'inline-block' }}>
        SCALP {analysis.entryQuality}
      </div>
    )}
  </div>
);

// ============ ASSET PAGE ============
const AssetPage = ({ symbol, name, data1m, data5m, refData, funding, refName }) => {
  const [backtest, setBacktest] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  
  const refAnalysis = useMemo(() => analyzeScalpSignals(refData, 0, 'NEUTRAL'), [refData]);
  const analysis1m = useMemo(() => analyzeScalpSignals(data1m, funding, refAnalysis.bias), [data1m, funding, refAnalysis.bias]);
  const analysis5m = useMemo(() => analyzeScalpSignals(data5m, funding, refAnalysis.bias), [data5m, funding, refAnalysis.bias]);
  
  // For scalping, 1m is primary, 5m is just context
  const mtfConfirmed = analysis1m.bias !== 'NEUTRAL' && (analysis5m.bias === analysis1m.bias || analysis5m.bias === 'NEUTRAL');
  
  const handleRunBacktest = () => {
    const result = runScalpBacktest(data1m);
    setBacktest(result);
    setShowBacktest(true);
  };
  
  const isScalpSetup = analysis1m.scalpReady && mtfConfirmed;
  const price = data1m.length > 0 ? data1m[data1m.length - 1].close : 0;
  const priceChange = data1m.length > 1 ? ((data1m[data1m.length - 1].close - data1m[data1m.length - 2].close) / data1m[data1m.length - 2].close) * 100 : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: '700' }}>{name} SCALP</span>
          {isScalpSetup && <span style={{ background: '#10b981', color: '#000', padding: '2px 8px', fontSize: '9px', fontWeight: '700', animation: 'pulse 1s infinite' }}>⚡ READY</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: '600' }}>${price?.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '10px' }}>{priceChange >= 0 ? '▲' : '▼'}{Math.abs(priceChange).toFixed(3)}%</span>
        </div>
      </div>
      
      {/* SCALP ALERT */}
      {isScalpSetup && (
        <div style={{ background: analysis1m.bias === 'LONG' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)', border: `2px solid ${analysis1m.bias === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '12px', marginBottom: '8px', textAlign: 'center' }}>
          <span style={{ color: analysis1m.bias === 'LONG' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '16px' }}>
            ⚡ SCALP {analysis1m.bias} — {analysis1m.entryQuality} Setup
          </span>
          <div style={{ color: '#888', fontSize: '10px', marginTop: '4px' }}>
            {analysis1m.qualityReasons?.join(' • ')}
          </div>
        </div>
      )}
      
      {/* 5m Context Warning */}
      {analysis1m.bias !== 'NEUTRAL' && analysis5m.bias !== 'NEUTRAL' && analysis5m.bias !== analysis1m.bias && (
        <div style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid #f59e0b', padding: '8px', marginBottom: '8px', textAlign: 'center' }}>
          <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '10px' }}>⚠️ 5M AGAINST — Higher timeframe disagrees, be cautious</span>
        </div>
      )}
      
      {/* Charts - 1M PRIMARY */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <div style={{ background: '#0a0a0a', border: `2px solid ${analysis1m.scalpReady ? '#10b981' : '#1a1a1a'}`, padding: '4px' }}>
          <div style={{ fontSize: '9px', color: analysis1m.scalpReady ? '#10b981' : '#666', marginBottom: '2px', display: 'flex', justifyContent: 'space-between', fontWeight: '600' }}>
            <span>1M — PRIMARY</span>
            <span>{analysis1m.bias} [{analysis1m.entryQuality}] ({analysis1m.score > 0 ? '+' : ''}{analysis1m.score})</span>
          </div>
          <Chart interval="1m" symbol={symbol} />
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '4px' }}>
          <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
            <span>5M — CONTEXT</span>
            <span style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : analysis5m.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis5m.bias}</span>
          </div>
          <Chart interval="5m" symbol={symbol} />
        </div>
      </div>
      
      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Key Stats for Scalping */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
            <StatBox label="VOL" value={`${analysis1m.volume?.relative?.toFixed(1) || '1.0'}x`} color={analysis1m.volume?.relative >= 2 ? '#10b981' : analysis1m.volume?.relative >= 1.2 ? '#3b82f6' : '#666'} highlight={analysis1m.volume?.spike} />
            <StatBox label="DELTA" value={analysis1m.volume?.delta?.toFixed(2) || '0'} color={analysis1m.volume?.delta > 0.3 ? '#10b981' : analysis1m.volume?.delta < -0.3 ? '#ef4444' : '#666'} />
            <StatBox label="MOM" value={`${analysis1m.momentum?.toFixed(2) || '0'}%`} color={analysis1m.momentum > 0.2 ? '#10b981' : analysis1m.momentum < -0.2 ? '#ef4444' : '#666'} />
            <StatBox label="RSI6" value={analysis1m.indicators?.rsi?.toFixed(0) || '--'} color={analysis1m.indicators?.rsi < 30 ? '#10b981' : analysis1m.indicators?.rsi > 70 ? '#ef4444' : '#888'} />
            <StatBox label={refName} value={refAnalysis.bias} color={refAnalysis.bias === 'LONG' ? '#10b981' : refAnalysis.bias === 'SHORT' ? '#ef4444' : '#666'} />
            <StatBox label="QUALITY" value={analysis1m.entryQuality || 'NONE'} color={analysis1m.entryQuality === 'A+' ? '#10b981' : analysis1m.entryQuality === 'A' ? '#3b82f6' : '#666'} />
          </div>
          
          {/* Signal Boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
            <SignalBox analysis={analysis1m} timeframe="1M PRIMARY" />
            <SignalBox analysis={analysis5m} timeframe="5M" />
            <SignalBox analysis={refAnalysis} timeframe={refName} />
          </div>
          
          {/* Candle Pattern Alert */}
          {analysis1m.candlePattern?.type !== 'neutral' && analysis1m.candlePattern?.pattern !== 'none' && (
            <div style={{ background: analysis1m.candlePattern.type === 'bullish' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${analysis1m.candlePattern.type === 'bullish' ? '#10b981' : '#ef4444'}`, padding: '8px', textAlign: 'center' }}>
              <span style={{ color: analysis1m.candlePattern.type === 'bullish' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '12px' }}>
                🔥 {analysis1m.candlePattern.pattern.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
          )}
          
          {/* SCALP Trade Plan */}
          {analysis1m.tradePlan && analysis1m.shouldTrade && (
            <div style={{ background: analysis1m.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `2px solid ${analysis1m.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '10px' }}>
              <div style={{ fontSize: '9px', color: '#888', letterSpacing: '1px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span>SCALP PLAN — {analysis1m.tradePlan.direction}</span>
                <span style={{ color: '#f59e0b' }}>MAX HOLD: {analysis1m.tradePlan.maxHold}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>ENTRY</div>
                  <div style={{ fontSize: '13px', color: '#fff', fontWeight: '600' }}>${analysis1m.tradePlan.entry.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>STOP</div>
                  <div style={{ fontSize: '13px', color: '#ef4444', fontWeight: '600' }}>${analysis1m.tradePlan.stopLoss.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                  <div style={{ fontSize: '8px', color: '#666' }}>{analysis1m.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>TP1 (1R)</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>${analysis1m.tradePlan.tp1.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                  <div style={{ fontSize: '7px', color: '#666' }}>TP2 (1.5R)</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>${analysis1m.tradePlan.tp2.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>BREAKEVEN</div>
                  <div style={{ fontSize: '11px', color: '#f59e0b' }}>${analysis1m.tradePlan.breakeven.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                  <div style={{ fontSize: '8px', color: '#666' }}>Move stop after 0.5R</div>
                </div>
              </div>
            </div>
          )}
          
          {!analysis1m.shouldTrade && analysis1m.noTradeReason && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', padding: '8px' }}>
              <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '9px' }}>⏳ WAIT: </span>
              <span style={{ color: '#888', fontSize: '9px' }}>{analysis1m.noTradeReason}</span>
            </div>
          )}
          
          {/* Backtest */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button onClick={handleRunBacktest} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST SCALP (1M)</button>
            <span style={{ fontSize: '8px', color: '#666' }}>Tests A/A+ setups on 500 candles</span>
          </div>
          
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px' }}>SCALP BACKTEST — 1M</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '12px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>WIN%</div><div style={{ fontSize: '12px', color: parseFloat(backtest.winRate) >= 55 ? '#10b981' : parseFloat(backtest.winRate) >= 45 ? '#f59e0b' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>TRADES</div><div style={{ fontSize: '12px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>P&L</div><div style={{ fontSize: '12px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>DD</div><div style={{ fontSize: '12px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>PF</div><div style={{ fontSize: '12px', color: parseFloat(backtest.profitFactor) > 1.2 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>EXPECT</div><div style={{ fontSize: '12px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>AVG DUR</div><div style={{ fontSize: '12px', color: '#888' }}>{backtest.avgDuration}m</div></div>
              </div>
              <div style={{ maxHeight: '120px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 20px 1fr 50px 20px 50px', padding: '2px 0', borderBottom: '1px solid #1a1a1a', fontSize: '8px', alignItems: 'center' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: t.quality === 'A+' ? '#10b981' : '#3b82f6', fontWeight: '600' }}>{t.quality}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(2)}→${t.exit.toFixed(2)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
                    <span style={{ color: '#888' }}>{t.duration}m</span>
                    <span style={{ color: t.pnl > 0 ? '#10b981' : '#ef4444', textAlign: 'right' }}>{t.pnlPercent > 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}R</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>SCALP INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <Badge label="EMA5" value={`$${analysis1m.indicators?.ema5?.toFixed(2) || '--'}`} status={analysis1m.indicators?.ema5 > analysis1m.indicators?.ema13 ? 'bullish' : 'bearish'} />
              <Badge label="EMA13" value={`$${analysis1m.indicators?.ema13?.toFixed(2) || '--'}`} status="neutral" />
              <Badge label="VWAP" value={`$${analysis1m.indicators?.vwap?.toFixed(2) || '--'}`} status={analysis1m.indicators?.price > analysis1m.indicators?.vwap ? 'bullish' : 'bearish'} />
              <Badge label="ATR" value={`$${analysis1m.indicators?.atr?.toFixed(3) || '--'}`} status="neutral" />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>BREAKDOWN</div>
            {Object.entries(analysis1m.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', marginBottom: '2px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k.replace('_', ' ')}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span>
                </div>
                <div style={{ height: '3px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '4px' }}>LIVE SIGNALS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {(analysis1m.signals || []).slice(0, 15).map((s, i) => (
                <div key={i} style={{ fontSize: '8px', padding: '2px 4px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ MAIN DASHBOARD ============
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('SOL');
  const [loading, setLoading] = useState(true);
  const [update, setUpdate] = useState(null);
  
  // Data states
  const [solData1m, setSolData1m] = useState([]);
  const [solData5m, setSolData5m] = useState([]);
  const [solFunding, setSolFunding] = useState(0);
  
  const [btcData1m, setBtcData1m] = useState([]);
  const [btcData5m, setBtcData5m] = useState([]);
  const [btcFunding, setBtcFunding] = useState(0);
  
  const [ethData1m, setEthData1m] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [solRes1m, solRes5m, btcRes1m, btcRes5m, ethRes1m] = await Promise.all([
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=200'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=200'),
          fetch('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=100')
        ]);
        
        const parse = (klines) => klines.map(k => ({ 
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), 
          close: parseFloat(k[4]), volume: parseFloat(k[5]) 
        }));
        
        const [solK1m, solK5m, btcK1m, btcK5m, ethK1m] = await Promise.all([
          solRes1m.json(), solRes5m.json(), btcRes1m.json(), btcRes5m.json(), ethRes1m.json()
        ]);
        
        setSolData1m(parse(solK1m));
        setSolData5m(parse(solK5m));
        setBtcData1m(parse(btcK1m));
        setBtcData5m(parse(btcK5m));
        setEthData1m(parse(ethK1m));
        
        // Funding
        try {
          const [solF, btcF] = await Promise.all([
            fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=1'),
            fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1')
          ]);
          const [solFData, btcFData] = await Promise.all([solF.json(), btcF.json()]);
          if (solFData[0]) setSolFunding(parseFloat(solFData[0].fundingRate));
          if (btcFData[0]) setBtcFunding(parseFloat(btcFData[0].fundingRate));
        } catch (e) {}
        
        setLoading(false);
        setUpdate(new Date());
      } catch (e) { setLoading(false); }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 2000); // 2 second refresh for scalping
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING SCALP DASHBOARD...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '8px' }}>
      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
        <button onClick={() => setActiveTab('SOL')} style={{ background: activeTab === 'SOL' ? '#10b981' : '#1a1a1a', color: activeTab === 'SOL' ? '#000' : '#888', border: 'none', padding: '8px 20px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>SOL SCALP</button>
        <button onClick={() => setActiveTab('BTC')} style={{ background: activeTab === 'BTC' ? '#f59e0b' : '#1a1a1a', color: activeTab === 'BTC' ? '#000' : '#888', border: 'none', padding: '8px 20px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>BTC SCALP</button>
      </div>
      
      {/* Asset Pages */}
      {activeTab === 'SOL' && (
        <AssetPage symbol="SOLUSDT" name="SOL" data1m={solData1m} data5m={solData5m} refData={btcData1m} funding={solFunding} refName="BTC" />
      )}
      {activeTab === 'BTC' && (
        <AssetPage symbol="BTCUSDT" name="BTC" data1m={btcData1m} data5m={btcData5m} refData={ethData1m} funding={btcFunding} refName="ETH" />
      )}
      
      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#444' }}>
        <div>SCALP MODE • 1M Primary • 2s refresh • Max 15min hold • {update?.toLocaleTimeString()}</div>
        <div>NFA DYOR</div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
