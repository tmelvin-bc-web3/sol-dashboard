import React, { useState, useEffect, useMemo, useRef } from 'react';

// ============ CHART COMPONENT ============
const Chart = ({ interval = '5m', symbol = 'SOLUSDT' }) => {
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
        height: 300,
        layout: { background: { color: '#0a0a0a' }, textColor: '#666' },
        grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: '#1a1a1a' },
        timeScale: { borderColor: '#1a1a1a', timeVisible: true },
      });
      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444',
        borderDownColor: '#ef4444', borderUpColor: '#10b981',
        wickDownColor: '#ef4444', wickUpColor: '#10b981',
      });

      const ema9 = chart.addLineSeries({ color: '#10b981', lineWidth: 1 });
      const ema21 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });
      const ema50 = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 });

      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`);
        const data = await res.json();
        const candles = data.map(d => ({ time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) }));
        candleSeries.setData(candles);

        const calcEMA = (data, period) => {
          const k = 2 / (period + 1); let ema = data[0].close;
          return data.map((d, i) => { if (i === 0) return { time: d.time, value: ema }; ema = d.close * k + ema * (1 - k); return { time: d.time, value: ema }; });
        };
        
        ema9.setData(calcEMA(candles, 9));
        ema21.setData(calcEMA(candles, 21));
        ema50.setData(calcEMA(candles, 50));
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

  return <div ref={containerRef} style={{ width: '100%', height: '300px' }} />;
};

// ============ TECHNICAL INDICATORS ============
const calcEMA = (data, period) => {
  const k = 2 / (period + 1); let ema = data[0]?.close || 0;
  return data.map((d, i) => { if (i === 0) return ema; ema = d.close * k + ema * (1 - k); return ema; });
};

const calcRSI = (data, period = 14) => {
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

const calcATR = (data, period = 14) => {
  const tr = data.map((d, i) => i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - data[i-1].close), Math.abs(d.low - data[i-1].close)));
  return tr.map((_, i) => i < period ? tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
};

const calcADX = (data, period = 14) => {
  const tr = data.map((d, i) => i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - data[i-1].close), Math.abs(d.low - data[i-1].close)));
  const plusDM = data.map((d, i) => { if (i === 0) return 0; const up = d.high - data[i-1].high, down = data[i-1].low - d.low; return up > down && up > 0 ? up : 0; });
  const minusDM = data.map((d, i) => { if (i === 0) return 0; const up = d.high - data[i-1].high, down = data[i-1].low - d.low; return down > up && down > 0 ? down : 0; });
  const smooth = (arr) => arr.map((_, i) => i < period ? arr.slice(0, i + 1).reduce((a, b) => a + b, 0) : arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0));
  const sTR = smooth(tr), sPlus = smooth(plusDM), sMinus = smooth(minusDM);
  const plusDI = sPlus.map((v, i) => sTR[i] === 0 ? 0 : (v / sTR[i]) * 100);
  const minusDI = sMinus.map((v, i) => sTR[i] === 0 ? 0 : (v / sTR[i]) * 100);
  const dx = plusDI.map((v, i) => { const sum = v + minusDI[i]; return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100; });
  const adx = dx.map((_, i) => i < period * 2 ? dx.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : dx.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  return { adx, plusDI, minusDI };
};

// ============ MARKET STRUCTURE ============
const analyzeStructure = (data, lookback = 30) => {
  if (data.length < lookback) return { trend: 'ranging', levels: [], strength: 0 };
  
  const recent = data.slice(-lookback);
  
  // Find swing highs and lows
  const swings = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high && 
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swings.push({ type: 'high', price: recent[i].high, index: i });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low && 
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swings.push({ type: 'low', price: recent[i].low, index: i });
    }
  }
  
  const highs = swings.filter(s => s.type === 'high').map(s => s.price);
  const lows = swings.filter(s => s.type === 'low').map(s => s.price);
  
  let trend = 'ranging';
  let strength = 0;
  
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1] > highs[highs.length - 2];
    const hl = lows[lows.length - 1] > lows[lows.length - 2];
    const lh = highs[highs.length - 1] < highs[highs.length - 2];
    const ll = lows[lows.length - 1] < lows[lows.length - 2];
    
    if (hh && hl) { trend = 'uptrend'; strength = 80; }
    else if (lh && ll) { trend = 'downtrend'; strength = 80; }
    else if (hh && !hl) { trend = 'uptrend'; strength = 50; }
    else if (ll && !lh) { trend = 'downtrend'; strength = 50; }
  }
  
  // Key levels
  const resistance = highs.length > 0 ? Math.max(...highs.slice(-3)) : recent[recent.length - 1].high;
  const support = lows.length > 0 ? Math.min(...lows.slice(-3)) : recent[recent.length - 1].low;
  
  return { trend, strength, resistance, support, swings, highs, lows };
};

// ============ VOLUME ANALYSIS ============
const analyzeVolume = (data, period = 20) => {
  if (data.length < period) return { relative: 1, trend: 'neutral', pressure: 0 };
  
  const recent = data.slice(-period);
  const avgVolume = recent.reduce((a, b) => a + b.volume, 0) / period;
  const currentVolume = data[data.length - 1].volume;
  const relative = currentVolume / avgVolume;
  
  // Buy/sell pressure
  let buyVol = 0, sellVol = 0;
  for (let i = 1; i < recent.length; i++) {
    const vol = recent[i].volume;
    const move = recent[i].close - recent[i].open;
    if (move > 0) buyVol += vol;
    else sellVol += vol;
  }
  const pressure = buyVol + sellVol > 0 ? (buyVol - sellVol) / (buyVol + sellVol) : 0;
  
  // Volume trend
  const recentAvg = data.slice(-5).reduce((a, b) => a + b.volume, 0) / 5;
  const olderAvg = data.slice(-10, -5).reduce((a, b) => a + b.volume, 0) / 5;
  const trend = recentAvg > olderAvg * 1.2 ? 'increasing' : recentAvg < olderAvg * 0.8 ? 'decreasing' : 'stable';
  
  return { relative, trend, pressure, avgVolume, currentVolume, spike: relative > 2 };
};

// ============ PRICE ACTION ============
const analyzePriceAction = (data) => {
  if (data.length < 5) return { pattern: 'none', momentum: 0, strength: 0 };
  
  const c0 = data[data.length - 1];
  const c1 = data[data.length - 2];
  const c2 = data[data.length - 3];
  
  const body0 = Math.abs(c0.close - c0.open);
  const body1 = Math.abs(c1.close - c1.open);
  const range0 = c0.high - c0.low;
  const isBull0 = c0.close > c0.open;
  const isBull1 = c1.close > c1.open;
  
  let pattern = 'none';
  let strength = 0;
  let type = 'neutral';
  
  // Engulfing
  if (isBull0 && !isBull1 && c0.close > c1.open && c0.open < c1.close && body0 > body1) {
    pattern = 'Bullish Engulfing'; strength = 3; type = 'bullish';
  } else if (!isBull0 && isBull1 && c0.close < c1.open && c0.open > c1.close && body0 > body1) {
    pattern = 'Bearish Engulfing'; strength = 3; type = 'bearish';
  }
  
  // Pin bars
  const lowerWick = Math.min(c0.open, c0.close) - c0.low;
  const upperWick = c0.high - Math.max(c0.open, c0.close);
  if (lowerWick > body0 * 2 && upperWick < body0 * 0.5) {
    pattern = 'Hammer'; strength = 2; type = 'bullish';
  } else if (upperWick > body0 * 2 && lowerWick < body0 * 0.5) {
    pattern = 'Shooting Star'; strength = 2; type = 'bearish';
  }
  
  // Strong momentum candle
  if (body0 > range0 * 0.7 && body0 > body1 * 1.5) {
    if (isBull0) { pattern = 'Strong Bullish'; strength = 2; type = 'bullish'; }
    else { pattern = 'Strong Bearish'; strength = 2; type = 'bearish'; }
  }
  
  // Momentum (last 5 candles)
  const closes = data.slice(-5).map(d => d.close);
  const momentum = ((closes[4] - closes[0]) / closes[0]) * 100;
  
  return { pattern, strength, type, momentum };
};

// ============ SIGNAL ANALYSIS ============
const analyzeSignals = (data, funding = 0, refBias = 'NEUTRAL') => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null, score: 0 };
  
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  
  // Calculate all indicators
  const ema9 = calcEMA(data, 9);
  const ema21 = calcEMA(data, 21);
  const ema50 = calcEMA(data, 50);
  const rsi = calcRSI(data, 14);
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data, 14);
  
  const structure = analyzeStructure(data, 30);
  const volume = analyzeVolume(data, 20);
  const priceAction = analyzePriceAction(data);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { 
    trend: { score: 0, max: 30, signals: [] }, 
    momentum: { score: 0, max: 25, signals: [] }, 
    structure: { score: 0, max: 25, signals: [] },
    confirmation: { score: 0, max: 20, signals: [] }
  };
  
  const le9 = ema9[ema9.length - 1], le21 = ema21[ema21.length - 1], le50 = ema50[ema50.length - 1];
  const pe9 = ema9[ema9.length - 2], pe21 = ema21[ema21.length - 2];
  const lRSI = rsi[rsi.length - 1], pRSI = rsi[rsi.length - 2];
  const lMACD = macd[macd.length - 1], lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1], pHist = histogram[histogram.length - 2];
  const lADX = adx[adx.length - 1];
  const lPlus = plusDI[plusDI.length - 1], lMinus = minusDI[minusDI.length - 1];
  const lATR = atr[atr.length - 1];
  
  // ============ TREND (30 pts) ============
  // EMA Stack
  if (le9 > le21 && le21 > le50) { 
    bullScore += 12; breakdown.trend.score += 12; 
    breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs bullish (9>21>50)' }); 
  } else if (le9 < le21 && le21 < le50) { 
    bearScore += 12; breakdown.trend.score -= 12; 
    breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs bearish (9<21<50)' }); 
  } else if (le9 > le21) {
    bullScore += 6; breakdown.trend.score += 6;
    breakdown.trend.signals.push({ type: 'bullish', text: 'EMA9 > EMA21' });
  } else if (le9 < le21) {
    bearScore += 6; breakdown.trend.score -= 6;
    breakdown.trend.signals.push({ type: 'bearish', text: 'EMA9 < EMA21' });
  }
  
  // EMA Cross
  if (pe9 <= pe21 && le9 > le21) { 
    bullScore += 10; breakdown.trend.score += 10; 
    breakdown.trend.signals.push({ type: 'bullish', text: '⚡ EMA Cross UP' }); 
  }
  if (pe9 >= pe21 && le9 < le21) { 
    bearScore += 10; breakdown.trend.score -= 10; 
    breakdown.trend.signals.push({ type: 'bearish', text: '⚡ EMA Cross DOWN' }); 
  }
  
  // Price position
  if (latest.close > le9 && latest.close > le21) {
    bullScore += 5; breakdown.trend.score += 5;
    breakdown.trend.signals.push({ type: 'bullish', text: 'Price above EMAs' });
  } else if (latest.close < le9 && latest.close < le21) {
    bearScore += 5; breakdown.trend.score -= 5;
    breakdown.trend.signals.push({ type: 'bearish', text: 'Price below EMAs' });
  }
  
  // ADX trend strength
  if (lADX > 25) {
    if (lPlus > lMinus) { 
      bullScore += 5; breakdown.trend.score += 5;
      breakdown.trend.signals.push({ type: 'bullish', text: `ADX ${lADX.toFixed(0)} trending ↑` });
    } else { 
      bearScore += 5; breakdown.trend.score -= 5;
      breakdown.trend.signals.push({ type: 'bearish', text: `ADX ${lADX.toFixed(0)} trending ↓` });
    }
  }
  
  // ============ MOMENTUM (25 pts) ============
  // RSI
  if (lRSI < 30) { 
    bullScore += 8; breakdown.momentum.score += 8; 
    breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold (${lRSI.toFixed(0)})` }); 
  } else if (lRSI > 70) { 
    bearScore += 8; breakdown.momentum.score -= 8; 
    breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought (${lRSI.toFixed(0)})` }); 
  } else if (lRSI > 55 && lRSI > pRSI) {
    bullScore += 4; breakdown.momentum.score += 4;
    breakdown.momentum.signals.push({ type: 'bullish', text: `RSI ${lRSI.toFixed(0)} rising` });
  } else if (lRSI < 45 && lRSI < pRSI) {
    bearScore += 4; breakdown.momentum.score -= 4;
    breakdown.momentum.signals.push({ type: 'bearish', text: `RSI ${lRSI.toFixed(0)} falling` });
  }
  
  // MACD
  if (lMACD > lSig && lHist > pHist) { 
    bullScore += 8; breakdown.momentum.score += 8; 
    breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD bullish + accelerating' }); 
  } else if (lMACD < lSig && lHist < pHist) { 
    bearScore += 8; breakdown.momentum.score -= 8; 
    breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD bearish + accelerating' }); 
  } else if (lMACD > lSig) {
    bullScore += 4; breakdown.momentum.score += 4;
    breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD > Signal' });
  } else {
    bearScore += 4; breakdown.momentum.score -= 4;
    breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD < Signal' });
  }
  
  // Price action pattern
  if (priceAction.type === 'bullish') {
    const pts = priceAction.strength * 3;
    bullScore += pts; breakdown.momentum.score += pts;
    breakdown.momentum.signals.push({ type: 'bullish', text: `🔥 ${priceAction.pattern}` });
  } else if (priceAction.type === 'bearish') {
    const pts = priceAction.strength * 3;
    bearScore += pts; breakdown.momentum.score -= pts;
    breakdown.momentum.signals.push({ type: 'bearish', text: `🔥 ${priceAction.pattern}` });
  }
  
  // ============ STRUCTURE (25 pts) ============
  // Market structure
  if (structure.trend === 'uptrend') {
    bullScore += 10; breakdown.structure.score += 10;
    breakdown.structure.signals.push({ type: 'bullish', text: 'Higher highs & lows' });
  } else if (structure.trend === 'downtrend') {
    bearScore += 10; breakdown.structure.score -= 10;
    breakdown.structure.signals.push({ type: 'bearish', text: 'Lower highs & lows' });
  } else {
    breakdown.structure.signals.push({ type: 'neutral', text: 'Ranging/choppy' });
  }
  
  // Key levels
  const nearResistance = latest.close > structure.resistance * 0.995;
  const nearSupport = latest.close < structure.support * 1.005;
  const breakResistance = latest.close > structure.resistance && prev.close <= structure.resistance;
  const breakSupport = latest.close < structure.support && prev.close >= structure.support;
  
  if (breakResistance) {
    bullScore += 12; breakdown.structure.score += 12;
    breakdown.structure.signals.push({ type: 'bullish', text: '⚡ Break above resistance!' });
  } else if (breakSupport) {
    bearScore += 12; breakdown.structure.score -= 12;
    breakdown.structure.signals.push({ type: 'bearish', text: '⚡ Break below support!' });
  } else if (nearResistance) {
    breakdown.structure.signals.push({ type: 'neutral', text: 'Near resistance' });
  } else if (nearSupport) {
    breakdown.structure.signals.push({ type: 'neutral', text: 'Near support' });
  }
  
  // Volume confirmation
  if (volume.spike) {
    if (latest.close > prev.close) { 
      bullScore += 6; breakdown.structure.score += 6;
      breakdown.structure.signals.push({ type: 'bullish', text: `Volume spike ${volume.relative.toFixed(1)}x` });
    } else { 
      bearScore += 6; breakdown.structure.score -= 6;
      breakdown.structure.signals.push({ type: 'bearish', text: `Volume spike ${volume.relative.toFixed(1)}x` });
    }
  } else if (volume.relative > 1.2) {
    breakdown.structure.signals.push({ type: 'neutral', text: `Volume ${volume.relative.toFixed(1)}x avg` });
  }
  
  // ============ CONFIRMATION (20 pts) ============
  // Reference asset alignment
  if (refBias === 'LONG') { 
    bullScore += 8; breakdown.confirmation.score += 8; 
    breakdown.confirmation.signals.push({ type: 'bullish', text: 'BTC bullish ✓' }); 
  } else if (refBias === 'SHORT') { 
    bearScore += 8; breakdown.confirmation.score -= 8; 
    breakdown.confirmation.signals.push({ type: 'bearish', text: 'BTC bearish ✓' }); 
  } else {
    breakdown.confirmation.signals.push({ type: 'neutral', text: 'BTC neutral' });
  }
  
  // Volume pressure
  if (volume.pressure > 0.3) {
    bullScore += 5; breakdown.confirmation.score += 5;
    breakdown.confirmation.signals.push({ type: 'bullish', text: 'Buy pressure dominant' });
  } else if (volume.pressure < -0.3) {
    bearScore += 5; breakdown.confirmation.score -= 5;
    breakdown.confirmation.signals.push({ type: 'bearish', text: 'Sell pressure dominant' });
  }
  
  // Funding
  const fundingPct = funding * 100;
  if (fundingPct > 0.05) { 
    bearScore += 5; breakdown.confirmation.score -= 5; 
    breakdown.confirmation.signals.push({ type: 'bearish', text: `High funding ${fundingPct.toFixed(3)}%` }); 
  } else if (fundingPct < -0.03) { 
    bullScore += 5; breakdown.confirmation.score += 5; 
    breakdown.confirmation.signals.push({ type: 'bullish', text: `Neg funding ${fundingPct.toFixed(3)}%` }); 
  }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  
  let bias = 'NEUTRAL'; 
  if (totalScore >= 15) bias = 'LONG'; 
  else if (totalScore <= -15) bias = 'SHORT';
  
  // ============ CONVICTION & ENTRY QUALITY ============
  let conviction = 'LOW';
  let convictionReasons = [];
  let shouldTrade = false;
  
  if (bias !== 'NEUTRAL') {
    let convictionScore = 0;
    
    if (bias === 'LONG') {
      if (structure.trend === 'uptrend') { convictionScore += 2; convictionReasons.push('Trend aligned'); }
      if (le9 > le21 && le21 > le50) { convictionScore += 2; convictionReasons.push('EMAs stacked'); }
      if (priceAction.type === 'bullish') { convictionScore += 2; convictionReasons.push(priceAction.pattern); }
      if (volume.relative > 1.3) { convictionScore += 1; convictionReasons.push('Volume'); }
      if (refBias === 'LONG') { convictionScore += 2; convictionReasons.push('BTC aligned'); }
      if (lRSI > 40 && lRSI < 70) { convictionScore += 1; convictionReasons.push('RSI OK'); }
      if (lMACD > lSig) { convictionScore += 1; convictionReasons.push('MACD bullish'); }
      if (breakResistance) { convictionScore += 2; convictionReasons.push('Breakout'); }
    } else {
      if (structure.trend === 'downtrend') { convictionScore += 2; convictionReasons.push('Trend aligned'); }
      if (le9 < le21 && le21 < le50) { convictionScore += 2; convictionReasons.push('EMAs stacked'); }
      if (priceAction.type === 'bearish') { convictionScore += 2; convictionReasons.push(priceAction.pattern); }
      if (volume.relative > 1.3) { convictionScore += 1; convictionReasons.push('Volume'); }
      if (refBias === 'SHORT') { convictionScore += 2; convictionReasons.push('BTC aligned'); }
      if (lRSI < 60 && lRSI > 30) { convictionScore += 1; convictionReasons.push('RSI OK'); }
      if (lMACD < lSig) { convictionScore += 1; convictionReasons.push('MACD bearish'); }
      if (breakSupport) { convictionScore += 2; convictionReasons.push('Breakdown'); }
    }
    
    if (convictionScore >= 8) { conviction = 'HIGH'; shouldTrade = true; }
    else if (convictionScore >= 5) { conviction = 'MEDIUM'; shouldTrade = true; }
    else { conviction = 'LOW'; }
  }
  
  // Additional filters
  let noTradeReason = '';
  if (lADX < 15 && !breakResistance && !breakSupport) { shouldTrade = false; noTradeReason = 'No trend or breakout'; }
  if (volume.relative < 0.7) { shouldTrade = false; noTradeReason = 'Volume too low'; }
  if (structure.trend === 'ranging' && !breakResistance && !breakSupport) { shouldTrade = false; noTradeReason = 'Choppy market'; }
  
  // ============ TRADE PLAN ============
  let tradePlan = null;
  if (bias !== 'NEUTRAL') {
    const price = latest.close;
    
    if (bias === 'LONG') {
      const entry = price;
      const stopLoss = Math.min(structure.support - lATR * 0.3, le21 - lATR * 0.5, latest.low - lATR * 0.3);
      const risk = entry - stopLoss;
      tradePlan = {
        direction: 'LONG',
        entry,
        stopLoss,
        tp1: entry + risk * 1.5,
        tp2: entry + risk * 2.5,
        tp3: entry + risk * 4,
        riskPercent: ((risk / entry) * 100).toFixed(2),
        riskR: risk,
        atr: lATR,
        resistance: structure.resistance,
        support: structure.support
      };
    } else {
      const entry = price;
      const stopLoss = Math.max(structure.resistance + lATR * 0.3, le21 + lATR * 0.5, latest.high + lATR * 0.3);
      const risk = stopLoss - entry;
      tradePlan = {
        direction: 'SHORT',
        entry,
        stopLoss,
        tp1: entry - risk * 1.5,
        tp2: entry - risk * 2.5,
        tp3: entry - risk * 4,
        riskPercent: ((risk / entry) * 100).toFixed(2),
        riskR: risk,
        atr: lATR,
        resistance: structure.resistance,
        support: structure.support
      };
    }
  }
  
  return { 
    bias, 
    confidence: Math.min(Math.abs(totalScore) * 2, 100).toFixed(0), 
    bullScore, bearScore, signals, breakdown, shouldTrade, noTradeReason, tradePlan, score: totalScore,
    structure, volume, priceAction, conviction, convictionReasons,
    indicators: { rsi: lRSI, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, ema9: le9, ema21: le21, ema50: le50, price: latest.close } 
  };
};

// ============ BACKTEST ============
const runBacktest = (data, initialCapital = 10000) => {
  if (data.length < 100) return null;
  
  const trades = [];
  let position = null;
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  let skippedTrades = 0;
  
  for (let i = 50; i < data.length - 1; i++) {
    const slice = data.slice(0, i + 1);
    const analysis = analyzeSignals(slice, 0, 'NEUTRAL');
    const currentCandle = data[i];
    const nextCandle = data[i + 1];
    
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'LONG') {
        if (nextCandle.low <= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop'; }
        else if (nextCandle.high >= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (nextCandle.high >= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true; 
          position.stopLoss = position.entry + position.riskR * 0.3;
        }
        else if (analysis.bias === 'SHORT' && analysis.score <= -18) { exitPrice = nextCandle.open; exitReason = 'Flip'; }
      } else {
        if (nextCandle.high >= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop'; }
        else if (nextCandle.low <= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (nextCandle.low <= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true; 
          position.stopLoss = position.entry - position.riskR * 0.3;
        }
        else if (analysis.bias === 'LONG' && analysis.score >= 18) { exitPrice = nextCandle.open; exitReason = 'Flip'; }
      }
      
      if (!exitPrice && i - position.entryIndex > 50) { exitPrice = nextCandle.close; exitReason = 'Time'; }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' 
          ? (exitPrice - position.entry) * position.size 
          : (position.entry - exitPrice) * position.size;
        const rMultiple = pnl / (position.riskR * position.size);
        capital += pnl;
        maxCapital = Math.max(maxCapital, capital);
        maxDrawdown = Math.max(maxDrawdown, ((maxCapital - capital) / maxCapital) * 100);
        trades.push({ direction: position.direction, entry: position.entry, exit: exitPrice, pnl, pnlPercent: rMultiple, reason: exitReason, conviction: position.conviction });
        position = null;
      }
    }
    
    if (!position && analysis.tradePlan && analysis.shouldTrade) {
      const validEntry = Math.abs(analysis.score) >= 18 && (analysis.conviction === 'HIGH' || analysis.conviction === 'MEDIUM');
      
      if (validEntry) {
        const plan = analysis.tradePlan;
        const riskPerTrade = capital * 0.01;
        const stopDistance = Math.abs(currentCandle.close - plan.stopLoss);
        const positionSize = riskPerTrade / stopDistance;
        
        position = {
          direction: plan.direction,
          entry: currentCandle.close,
          stopLoss: plan.stopLoss,
          tp1: plan.tp1,
          tp2: plan.tp2,
          riskR: plan.riskR,
          tp1Hit: false,
          entryIndex: i,
          size: positionSize,
          conviction: analysis.conviction
        };
      } else if (Math.abs(analysis.score) >= 15) {
        skippedTrades++;
      }
    }
  }
  
  if (position) {
    const lastPrice = data[data.length - 1].close;
    const pnl = position.direction === 'LONG' 
      ? (lastPrice - position.entry) * position.size 
      : (position.entry - lastPrice) * position.size;
    const rMultiple = pnl / (position.riskR * position.size);
    trades.push({ direction: position.direction, entry: position.entry, exit: lastPrice, pnl, pnlPercent: rMultiple, reason: 'End', conviction: position.conviction });
    capital += pnl;
  }
  
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  
  return {
    totalTrades: trades.length, winningTrades: wins.length, losingTrades: losses.length, skippedTrades,
    winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: wins.length > 0 ? (wins.reduce((a, t) => a + t.pnlPercent, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length > 0 ? (losses.reduce((a, t) => a + t.pnlPercent, 0) / losses.length).toFixed(2) : 0,
    totalPnL: ((capital - initialCapital) / initialCapital * 100).toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : trades.length > 0 ? '∞' : '0',
    expectancy: trades.length > 0 ? (trades.reduce((a, t) => a + t.pnlPercent, 0) / trades.length).toFixed(2) : 0,
    trades: trades.slice(-20)
  };
};

// ============ UI COMPONENTS ============
const StatBox = ({ label, value, color = '#fff', sub = null }) => (
  <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px 10px', textAlign: 'center' }}>
    <div style={{ fontSize: '8px', color: '#555', letterSpacing: '1px', marginBottom: '2px' }}>{label}</div>
    <div style={{ fontSize: '15px', fontWeight: '600', color }}>{value}</div>
    {sub && <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>{sub}</div>}
  </div>
);

const SignalBox = ({ analysis, timeframe, large = false }) => (
  <div style={{ 
    background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', 
    border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#333'}`, 
    padding: large ? '15px' : '10px', 
    textAlign: 'center' 
  }}>
    <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', marginBottom: '4px' }}>{timeframe}</div>
    <div style={{ fontSize: large ? '36px' : '28px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#555' }}>
      {analysis.bias}
    </div>
    <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
      {analysis.score > 0 ? '+' : ''}{analysis.score} pts • {analysis.confidence}%
    </div>
    {analysis.conviction && analysis.conviction !== 'LOW' && (
      <div style={{ 
        marginTop: '8px', 
        background: analysis.conviction === 'HIGH' ? '#10b981' : '#3b82f6', 
        color: '#000', 
        padding: '4px 12px', 
        fontSize: '11px', 
        fontWeight: '700', 
        display: 'inline-block' 
      }}>
        {analysis.conviction} CONVICTION
      </div>
    )}
  </div>
);

// ============ ASSET PAGE ============
const AssetPage = ({ symbol, name, data5m, data1m, refData, funding, refName }) => {
  const [backtest, setBacktest] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  
  const refAnalysis = useMemo(() => analyzeSignals(refData, 0, 'NEUTRAL'), [refData]);
  const analysis5m = useMemo(() => analyzeSignals(data5m, funding, refAnalysis.bias), [data5m, funding, refAnalysis.bias]);
  const analysis1m = useMemo(() => analyzeSignals(data1m, funding, refAnalysis.bias), [data1m, funding, refAnalysis.bias]);
  
  const mtfAligned = analysis5m.bias !== 'NEUTRAL' && analysis1m.bias === analysis5m.bias;
  const highConviction = analysis5m.conviction === 'HIGH' && analysis5m.shouldTrade;
  
  const handleRunBacktest = (tf) => {
    const result = runBacktest(tf === '1m' ? data1m : data5m);
    setBacktest(result);
    setShowBacktest(true);
  };
  
  const price = data5m.length > 0 ? data5m[data5m.length - 1].close : 0;
  const price1m = data1m.length > 0 ? data1m[data1m.length - 1].close : 0;
  const priceChange = data5m.length > 1 ? ((price - data5m[data5m.length - 2].close) / data5m[data5m.length - 2].close) * 100 : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px', fontWeight: '700' }}>{name}/USDT</span>
          {highConviction && mtfAligned && (
            <span style={{ background: '#10b981', color: '#000', padding: '4px 12px', fontSize: '10px', fontWeight: '700' }}>
              ⚡ HIGH CONVICTION
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '22px', fontWeight: '600' }}>${price1m?.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
          <div style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '11px' }}>
            {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
          </div>
        </div>
      </div>
      
      {/* HIGH CONVICTION ALERT */}
      {highConviction && mtfAligned && (
        <div style={{ 
          background: analysis5m.bias === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', 
          border: `2px solid ${analysis5m.bias === 'LONG' ? '#10b981' : '#ef4444'}`, 
          padding: '15px', 
          marginBottom: '12px', 
          textAlign: 'center' 
        }}>
          <div style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '18px' }}>
            {analysis5m.bias} — HIGH CONVICTION
          </div>
          <div style={{ color: '#888', fontSize: '11px', marginTop: '6px' }}>
            {analysis5m.convictionReasons?.join(' • ')}
          </div>
        </div>
      )}
      
      {/* MTF Alignment Status */}
      {mtfAligned && !highConviction && (
        <div style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid #3b82f6', padding: '10px', marginBottom: '12px', textAlign: 'center' }}>
          <span style={{ color: '#3b82f6', fontWeight: '600', fontSize: '11px' }}>✓ 1M & 5M ALIGNED — {analysis5m.bias}</span>
        </div>
      )}
      
      {analysis5m.bias !== 'NEUTRAL' && analysis1m.bias !== 'NEUTRAL' && analysis5m.bias !== analysis1m.bias && (
        <div style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b', padding: '10px', marginBottom: '12px', textAlign: 'center' }}>
          <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '11px' }}>⚠ TIMEFRAME CONFLICT — 5M: {analysis5m.bias} vs 1M: {analysis1m.bias}</span>
        </div>
      )}
      
      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
          <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
            <span>5 MINUTE</span>
            <span style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : analysis5m.bias === 'SHORT' ? '#ef4444' : '#555' }}>
              {analysis5m.bias} ({analysis5m.score > 0 ? '+' : ''}{analysis5m.score})
            </span>
          </div>
          <Chart interval="5m" symbol={symbol} />
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
          <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
            <span>1 MINUTE</span>
            <span style={{ color: analysis1m.bias === 'LONG' ? '#10b981' : analysis1m.bias === 'SHORT' ? '#ef4444' : '#555' }}>
              {analysis1m.bias} ({analysis1m.score > 0 ? '+' : ''}{analysis1m.score})
            </span>
          </div>
          <Chart interval="1m" symbol={symbol} />
        </div>
      </div>
      
      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          {/* Key Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            <StatBox label="TREND" value={analysis5m.structure?.trend?.toUpperCase().slice(0,5) || 'RANGE'} color={analysis5m.structure?.trend === 'uptrend' ? '#10b981' : analysis5m.structure?.trend === 'downtrend' ? '#ef4444' : '#666'} />
            <StatBox label="RSI" value={analysis5m.indicators?.rsi?.toFixed(0) || '--'} color={analysis5m.indicators?.rsi > 70 ? '#ef4444' : analysis5m.indicators?.rsi < 30 ? '#10b981' : '#888'} />
            <StatBox label="ADX" value={analysis5m.indicators?.adx?.toFixed(0) || '--'} color={analysis5m.indicators?.adx > 25 ? '#10b981' : '#666'} />
            <StatBox label="VOL" value={`${analysis5m.volume?.relative?.toFixed(1) || '1.0'}x`} color={analysis5m.volume?.spike ? '#10b981' : '#888'} />
            <StatBox label={refName} value={refAnalysis.bias} color={refAnalysis.bias === 'LONG' ? '#10b981' : refAnalysis.bias === 'SHORT' ? '#ef4444' : '#666'} />
            <StatBox label="CONVICTION" value={analysis5m.conviction || 'LOW'} color={analysis5m.conviction === 'HIGH' ? '#10b981' : analysis5m.conviction === 'MEDIUM' ? '#3b82f6' : '#666'} />
          </div>
          
          {/* Signal Boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '10px' }}>
            <SignalBox analysis={analysis5m} timeframe="5 MINUTE" large />
            <SignalBox analysis={analysis1m} timeframe="1 MINUTE" />
            <SignalBox analysis={refAnalysis} timeframe={refName} />
          </div>
          
          {/* Price Action Alert */}
          {analysis5m.priceAction?.pattern !== 'none' && (
            <div style={{ 
              background: analysis5m.priceAction.type === 'bullish' ? 'rgba(16,185,129,0.1)' : analysis5m.priceAction.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'transparent', 
              border: `1px solid ${analysis5m.priceAction.type === 'bullish' ? '#10b981' : analysis5m.priceAction.type === 'bearish' ? '#ef4444' : '#333'}`, 
              padding: '10px', 
              textAlign: 'center' 
            }}>
              <span style={{ color: analysis5m.priceAction.type === 'bullish' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '13px' }}>
                🔥 {analysis5m.priceAction.pattern}
              </span>
            </div>
          )}
          
          {/* Trade Plan */}
          {analysis5m.tradePlan && analysis5m.shouldTrade && (
            <div style={{ 
              background: analysis5m.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', 
              border: `2px solid ${analysis5m.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, 
              padding: '12px' 
            }}>
              <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                <span>TRADE PLAN — {analysis5m.tradePlan.direction}</span>
                <span style={{ color: analysis5m.conviction === 'HIGH' ? '#10b981' : '#3b82f6' }}>{analysis5m.conviction} CONVICTION</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '8px', color: '#555' }}>ENTRY</div>
                  <div style={{ fontSize: '15px', color: '#fff', fontWeight: '600' }}>${analysis5m.tradePlan.entry.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#555' }}>STOP LOSS</div>
                  <div style={{ fontSize: '15px', color: '#ef4444', fontWeight: '600' }}>${analysis5m.tradePlan.stopLoss.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                  <div style={{ fontSize: '9px', color: '#666' }}>-{analysis5m.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#555' }}>TARGETS</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>TP1: ${analysis5m.tradePlan.tp1.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>TP2: ${analysis5m.tradePlan.tp2.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#555' }}>KEY LEVELS</div>
                  <div style={{ fontSize: '10px', color: '#ef4444' }}>R: ${analysis5m.tradePlan.resistance?.toFixed(2)}</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>S: ${analysis5m.tradePlan.support?.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
          
          {!analysis5m.shouldTrade && analysis5m.noTradeReason && (
            <div style={{ background: 'rgba(100,100,100,0.1)', border: '1px solid #333', padding: '12px', textAlign: 'center' }}>
              <span style={{ color: '#888', fontSize: '11px' }}>⏳ {analysis5m.noTradeReason} — waiting for better setup</span>
            </div>
          )}
          
          {/* Structure Info */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '9px', color: '#555' }}>RESISTANCE </span>
                <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: '600' }}>${analysis5m.structure?.resistance?.toFixed(2)}</span>
              </div>
              <div>
                <span style={{ fontSize: '9px', color: '#555' }}>STRUCTURE </span>
                <span style={{ fontSize: '12px', color: analysis5m.structure?.trend === 'uptrend' ? '#10b981' : analysis5m.structure?.trend === 'downtrend' ? '#ef4444' : '#666', fontWeight: '600' }}>
                  {analysis5m.structure?.trend?.toUpperCase()}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '9px', color: '#555' }}>SUPPORT </span>
                <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>${analysis5m.structure?.support?.toFixed(2)}</span>
              </div>
            </div>
          </div>
          
          {/* Backtest */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => handleRunBacktest('5m')} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 18px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 5M</button>
            <button onClick={() => handleRunBacktest('1m')} style={{ background: '#8b5cf6', color: '#fff', border: 'none', padding: '10px 18px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 1M</button>
          </div>
          
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '9px', color: '#555', letterSpacing: '1px' }}>BACKTEST RESULTS</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '14px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '10px' }}>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>WIN RATE</div><div style={{ fontSize: '14px', color: parseFloat(backtest.winRate) >= 50 ? '#10b981' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>TRADES</div><div style={{ fontSize: '14px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>P&L</div><div style={{ fontSize: '14px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>DRAWDOWN</div><div style={{ fontSize: '14px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>PROFIT FACTOR</div><div style={{ fontSize: '14px', color: parseFloat(backtest.profitFactor) > 1 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>EXPECTANCY</div><div style={{ fontSize: '14px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#555' }}>SKIPPED</div><div style={{ fontSize: '14px', color: '#f59e0b' }}>{backtest.skippedTrades}</div></div>
              </div>
              <div style={{ maxHeight: '130px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 50px 1fr 50px 60px', padding: '4px 0', borderBottom: '1px solid #1a1a1a', fontSize: '9px', alignItems: 'center' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: t.conviction === 'HIGH' ? '#10b981' : '#3b82f6' }}>{t.conviction}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
                    <span style={{ color: t.pnl > 0 ? '#10b981' : '#ef4444', textAlign: 'right' }}>{t.pnlPercent > 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}R</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
            <div style={{ fontSize: '8px', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div style={{ background: '#111', padding: '6px', borderLeft: `2px solid ${analysis5m.indicators?.ema9 > analysis5m.indicators?.ema21 ? '#10b981' : '#ef4444'}` }}>
                <div style={{ fontSize: '7px', color: '#555' }}>EMA 9</div>
                <div style={{ fontSize: '11px', color: '#fff' }}>${analysis5m.indicators?.ema9?.toFixed(2)}</div>
              </div>
              <div style={{ background: '#111', padding: '6px', borderLeft: '2px solid #f59e0b' }}>
                <div style={{ fontSize: '7px', color: '#555' }}>EMA 21</div>
                <div style={{ fontSize: '11px', color: '#fff' }}>${analysis5m.indicators?.ema21?.toFixed(2)}</div>
              </div>
              <div style={{ background: '#111', padding: '6px', borderLeft: `2px solid ${analysis5m.indicators?.macd > analysis5m.indicators?.macdSignal ? '#10b981' : '#ef4444'}` }}>
                <div style={{ fontSize: '7px', color: '#555' }}>MACD</div>
                <div style={{ fontSize: '11px', color: analysis5m.indicators?.macd > analysis5m.indicators?.macdSignal ? '#10b981' : '#ef4444' }}>{analysis5m.indicators?.macd?.toFixed(3)}</div>
              </div>
              <div style={{ background: '#111', padding: '6px', borderLeft: '2px solid #666' }}>
                <div style={{ fontSize: '7px', color: '#555' }}>ATR</div>
                <div style={{ fontSize: '11px', color: '#fff' }}>${analysis5m.indicators?.atr?.toFixed(3)}</div>
              </div>
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
            <div style={{ fontSize: '8px', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>SCORE BREAKDOWN</div>
            {Object.entries(analysis5m.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '3px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#555' }}>{c.score > 0 ? '+' : ''}{c.score}/{c.max}</span>
                </div>
                <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#333' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: '8px', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>SIGNALS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(analysis5m.signals || []).map((s, i) => (
                <div key={i} style={{ 
                  fontSize: '9px', 
                  padding: '4px 6px', 
                  background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', 
                  borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#555'}`, 
                  color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' 
                }}>
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
  
  const [solData5m, setSolData5m] = useState([]);
  const [solData1m, setSolData1m] = useState([]);
  const [solFunding, setSolFunding] = useState(0);
  
  const [btcData5m, setBtcData5m] = useState([]);
  const [btcData1m, setBtcData1m] = useState([]);
  const [btcFunding, setBtcFunding] = useState(0);
  
  const [ethData5m, setEthData5m] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [solRes5m, solRes1m, btcRes5m, btcRes1m, ethRes5m] = await Promise.all([
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=5m&limit=150')
        ]);
        
        const parse = (klines) => klines.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        
        const [solK5m, solK1m, btcK5m, btcK1m, ethK5m] = await Promise.all([
          solRes5m.json(), solRes1m.json(), btcRes5m.json(), btcRes1m.json(), ethRes5m.json()
        ]);
        
        setSolData5m(parse(solK5m));
        setSolData1m(parse(solK1m));
        setBtcData5m(parse(btcK5m));
        setBtcData1m(parse(btcK1m));
        setEthData5m(parse(ethK5m));
        
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
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '12px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button onClick={() => setActiveTab('SOL')} style={{ background: activeTab === 'SOL' ? '#10b981' : '#1a1a1a', color: activeTab === 'SOL' ? '#000' : '#666', border: 'none', padding: '10px 24px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>SOL</button>
        <button onClick={() => setActiveTab('BTC')} style={{ background: activeTab === 'BTC' ? '#f59e0b' : '#1a1a1a', color: activeTab === 'BTC' ? '#000' : '#666', border: 'none', padding: '10px 24px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>BTC</button>
      </div>
      
      {activeTab === 'SOL' && (
        <AssetPage symbol="SOLUSDT" name="SOL" data5m={solData5m} data1m={solData1m} refData={btcData5m} funding={solFunding} refName="BTC" />
      )}
      {activeTab === 'BTC' && (
        <AssetPage symbol="BTCUSDT" name="BTC" data5m={btcData5m} data1m={btcData1m} refData={ethData5m} funding={btcFunding} refName="ETH" />
      )}
      
      <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#333' }}>
        <div>Chart Analysis • 1M + 5M • 3s refresh • {update?.toLocaleTimeString()}</div>
        <div>NFA DYOR</div>
      </div>
    </div>
  );
}
