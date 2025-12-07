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

      const ema20 = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
      const ema50 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2 });

      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`);
        const data = await res.json();
        const candles = data.map(d => ({ time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) }));
        candleSeries.setData(candles);

        const calcEMA = (data, period) => {
          const k = 2 / (period + 1); let ema = data[0].close;
          return data.map((d, i) => { if (i === 0) return { time: d.time, value: ema }; ema = d.close * k + ema * (1 - k); return { time: d.time, value: ema }; });
        };
        
        ema20.setData(calcEMA(candles, 20));
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

// ============ INDICATORS ============
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

// Bollinger Bands for squeeze detection
const calcBB = (data, period = 20, mult = 2) => data.map((_, i) => {
  if (i < period - 1) return { upper: data[i].close, lower: data[i].close, middle: data[i].close, width: 0.05 };
  const slice = data.slice(i - period + 1, i + 1), sma = slice.reduce((a, b) => a + b.close, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b.close - sma, 2), 0) / period);
  return { upper: sma + mult * std, lower: sma - mult * std, middle: sma, width: std > 0 ? (mult * std * 2) / sma : 0.01 };
});

// ============ BREAKOUT DETECTION ============
const detectConsolidation = (data, lookback = 30) => {
  if (data.length < lookback) return { inConsolidation: false };
  
  const recent = data.slice(-lookback);
  const highs = recent.map(d => d.high);
  const lows = recent.map(d => d.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangeSize = (rangeHigh - rangeLow) / rangeLow * 100;
  
  // Check if price has been ranging (less than 5% range for 30 candles)
  const isConsolidating = rangeSize < 5;
  
  // Find resistance and support levels
  const resistance = rangeHigh;
  const support = rangeLow;
  
  // Current position in range
  const currentPrice = data[data.length - 1].close;
  const positionInRange = (currentPrice - rangeLow) / (rangeHigh - rangeLow);
  
  return {
    inConsolidation: isConsolidating,
    resistance,
    support,
    rangeSize,
    positionInRange,
    rangeHigh,
    rangeLow
  };
};

const detectBreakout = (data, consolidation) => {
  if (data.length < 5) return { breakout: false };
  
  const current = data[data.length - 1];
  const prev = data[data.length - 2];
  const prev2 = data[data.length - 3];
  
  // Breakout above resistance
  const bullishBreakout = current.close > consolidation.resistance && 
                          prev.close <= consolidation.resistance &&
                          current.close > current.open;
  
  // Breakdown below support                        
  const bearishBreakout = current.close < consolidation.support && 
                          prev.close >= consolidation.support &&
                          current.close < current.open;
  
  // Check for failed breakout (wick above but close inside)
  const failedBullish = current.high > consolidation.resistance && current.close < consolidation.resistance;
  const failedBearish = current.low < consolidation.support && current.close > consolidation.support;
  
  return {
    bullishBreakout,
    bearishBreakout,
    failedBullish,
    failedBearish,
    resistance: consolidation.resistance,
    support: consolidation.support
  };
};

// Volume analysis for breakout confirmation
const analyzeBreakoutVolume = (data, period = 20) => {
  if (data.length < period) return { relative: 1, expanding: false, climax: false };
  
  const recent = data.slice(-period);
  const avgVolume = recent.reduce((a, b) => a + b.volume, 0) / period;
  const currentVolume = data[data.length - 1].volume;
  const prevVolume = data[data.length - 2].volume;
  const relative = currentVolume / avgVolume;
  
  // Volume expansion (last 3 candles increasing)
  const vol3 = data.slice(-3).map(d => d.volume);
  const expanding = vol3[2] > vol3[1] && vol3[1] > vol3[0];
  
  // Volume climax (huge spike)
  const climax = relative > 3;
  
  // Accumulation (above average volume on up moves)
  let accumulationScore = 0;
  for (let i = data.length - 10; i < data.length; i++) {
    if (data[i].close > data[i].open && data[i].volume > avgVolume) accumulationScore++;
    if (data[i].close < data[i].open && data[i].volume > avgVolume) accumulationScore--;
  }
  
  return { relative, expanding, climax, avgVolume, currentVolume, accumulationScore };
};

// Trend strength for big moves
const analyzeTrendStrength = (data) => {
  if (data.length < 50) return { strength: 0, direction: 'neutral' };
  
  const ema20 = calcEMA(data, 20);
  const ema50 = calcEMA(data, 50);
  const { adx, plusDI, minusDI } = calcADX(data);
  
  const le20 = ema20[ema20.length - 1];
  const le50 = ema50[ema50.length - 1];
  const lADX = adx[adx.length - 1];
  const lPlus = plusDI[plusDI.length - 1];
  const lMinus = minusDI[minusDI.length - 1];
  
  // Count candles above/below EMA20
  let above20 = 0, below20 = 0;
  for (let i = data.length - 20; i < data.length; i++) {
    if (data[i].close > ema20[i]) above20++;
    else below20++;
  }
  
  // Higher highs / lower lows count
  let hh = 0, ll = 0;
  for (let i = data.length - 20; i < data.length; i++) {
    if (i > 0 && data[i].high > data[i-1].high) hh++;
    if (i > 0 && data[i].low < data[i-1].low) ll++;
  }
  
  let strength = 0;
  let direction = 'neutral';
  
  if (le20 > le50 && lPlus > lMinus) {
    direction = 'bullish';
    strength = Math.min((above20 / 20) * 50 + (lADX > 25 ? 30 : lADX) + (hh > ll ? 20 : 0), 100);
  } else if (le20 < le50 && lMinus > lPlus) {
    direction = 'bearish';
    strength = Math.min((below20 / 20) * 50 + (lADX > 25 ? 30 : lADX) + (ll > hh ? 20 : 0), 100);
  }
  
  return { strength, direction, adx: lADX, ema20: le20, ema50: le50, above20, below20 };
};

// ============ SWING SIGNAL ANALYSIS ============
const analyzeSwingSignals = (data, funding = 0, refBias = 'NEUTRAL') => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null, score: 0 };
  
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  
  const ema20 = calcEMA(data, 20);
  const ema50 = calcEMA(data, 50);
  const ema200 = calcEMA(data, 200);
  const rsi = calcRSI(data, 14);
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data, 14);
  const bb = calcBB(data, 20);
  
  const consolidation = detectConsolidation(data, 30);
  const breakout = detectBreakout(data, consolidation);
  const volume = analyzeBreakoutVolume(data, 20);
  const trend = analyzeTrendStrength(data);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { 
    trend: { score: 0, max: 35, signals: [] }, 
    breakout: { score: 0, max: 35, signals: [] }, 
    momentum: { score: 0, max: 20, signals: [] },
    confluence: { score: 0, max: 20, signals: [] }
  };
  
  const le20 = ema20[ema20.length - 1];
  const le50 = ema50[ema50.length - 1];
  const le200 = ema200[ema200.length - 1];
  const lRSI = rsi[rsi.length - 1];
  const lMACD = macd[macd.length - 1];
  const lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1];
  const pHist = histogram[histogram.length - 2];
  const lADX = adx[adx.length - 1];
  const lATR = atr[atr.length - 1];
  const lBB = bb[bb.length - 1];
  
  // ============ TREND (35 pts) - Need strong trend for big moves ============
  if (le20 > le50 && le50 > le200) { 
    bullScore += 15; breakdown.trend.score += 15; 
    breakdown.trend.signals.push({ type: 'bullish', text: '✓ EMA 20>50>200 (uptrend)' }); 
  } else if (le20 < le50 && le50 < le200) { 
    bearScore += 15; breakdown.trend.score -= 15; 
    breakdown.trend.signals.push({ type: 'bearish', text: '✓ EMA 20<50<200 (downtrend)' }); 
  } else if (le20 > le50) {
    bullScore += 8; breakdown.trend.score += 8;
    breakdown.trend.signals.push({ type: 'bullish', text: 'EMA 20>50' });
  } else if (le20 < le50) {
    bearScore += 8; breakdown.trend.score -= 8;
    breakdown.trend.signals.push({ type: 'bearish', text: 'EMA 20<50' });
  }
  
  // ADX trend strength
  if (lADX > 30) {
    if (trend.direction === 'bullish') { 
      bullScore += 12; breakdown.trend.score += 12; 
      breakdown.trend.signals.push({ type: 'bullish', text: `Strong trend ADX ${lADX.toFixed(0)}` }); 
    } else if (trend.direction === 'bearish') { 
      bearScore += 12; breakdown.trend.score -= 12; 
      breakdown.trend.signals.push({ type: 'bearish', text: `Strong trend ADX ${lADX.toFixed(0)}` }); 
    }
  } else if (lADX > 20) {
    if (trend.direction === 'bullish') { bullScore += 6; breakdown.trend.score += 6; }
    else if (trend.direction === 'bearish') { bearScore += 6; breakdown.trend.score -= 6; }
    breakdown.trend.signals.push({ type: 'neutral', text: `Moderate trend ADX ${lADX.toFixed(0)}` });
  }
  
  // Price above/below key EMAs
  if (latest.close > le20 && latest.close > le50) {
    bullScore += 6; breakdown.trend.score += 6;
    breakdown.trend.signals.push({ type: 'bullish', text: 'Price above EMAs' });
  } else if (latest.close < le20 && latest.close < le50) {
    bearScore += 6; breakdown.trend.score -= 6;
    breakdown.trend.signals.push({ type: 'bearish', text: 'Price below EMAs' });
  }
  
  // ============ BREAKOUT (35 pts) - Key for catching big moves ============
  if (breakout.bullishBreakout) {
    bullScore += 20; breakdown.breakout.score += 20;
    breakdown.breakout.signals.push({ type: 'bullish', text: '🚀 BREAKOUT above resistance!' });
  } else if (breakout.bearishBreakout) {
    bearScore += 20; breakdown.breakout.score -= 20;
    breakdown.breakout.signals.push({ type: 'bearish', text: '🚀 BREAKDOWN below support!' });
  }
  
  if (breakout.failedBullish) {
    bearScore += 8; breakdown.breakout.score -= 8;
    breakdown.breakout.signals.push({ type: 'bearish', text: '⚠ Failed breakout (bull trap)' });
  } else if (breakout.failedBearish) {
    bullScore += 8; breakdown.breakout.score += 8;
    breakdown.breakout.signals.push({ type: 'bullish', text: '⚠ Failed breakdown (bear trap)' });
  }
  
  // Volume confirmation on breakout
  if (volume.climax) {
    if (latest.close > prev.close) { 
      bullScore += 15; breakdown.breakout.score += 15; 
      breakdown.breakout.signals.push({ type: 'bullish', text: `🔥 Volume climax ${volume.relative.toFixed(1)}x` }); 
    } else { 
      bearScore += 15; breakdown.breakout.score -= 15; 
      breakdown.breakout.signals.push({ type: 'bearish', text: `🔥 Volume climax ${volume.relative.toFixed(1)}x` }); 
    }
  } else if (volume.expanding && volume.relative > 1.5) {
    if (latest.close > prev.close) { 
      bullScore += 8; breakdown.breakout.score += 8; 
      breakdown.breakout.signals.push({ type: 'bullish', text: 'Volume expanding' }); 
    } else { 
      bearScore += 8; breakdown.breakout.score -= 8; 
      breakdown.breakout.signals.push({ type: 'bearish', text: 'Volume expanding' }); 
    }
  }
  
  // BB squeeze breakout
  if (lBB.width < 0.03 && consolidation.inConsolidation) {
    breakdown.breakout.signals.push({ type: 'neutral', text: '⚡ BB Squeeze - breakout imminent' });
  }
  
  // Consolidation context
  if (consolidation.inConsolidation) {
    breakdown.breakout.signals.push({ type: 'neutral', text: `Range: ${consolidation.rangeSize.toFixed(1)}%` });
  }
  
  // ============ MOMENTUM (20 pts) ============
  // RSI
  if (lRSI > 60 && lRSI < 80) { 
    bullScore += 6; breakdown.momentum.score += 6; 
    breakdown.momentum.signals.push({ type: 'bullish', text: `RSI ${lRSI.toFixed(0)} bullish` }); 
  } else if (lRSI < 40 && lRSI > 20) { 
    bearScore += 6; breakdown.momentum.score -= 6; 
    breakdown.momentum.signals.push({ type: 'bearish', text: `RSI ${lRSI.toFixed(0)} bearish` }); 
  } else if (lRSI >= 80) {
    breakdown.momentum.signals.push({ type: 'neutral', text: `RSI ${lRSI.toFixed(0)} extended` });
  } else if (lRSI <= 20) {
    breakdown.momentum.signals.push({ type: 'neutral', text: `RSI ${lRSI.toFixed(0)} oversold` });
  }
  
  // MACD
  if (lMACD > lSig && lHist > pHist) { 
    bullScore += 6; breakdown.momentum.score += 6; 
    breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD bullish + accelerating' }); 
  } else if (lMACD < lSig && lHist < pHist) { 
    bearScore += 6; breakdown.momentum.score -= 6; 
    breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD bearish + accelerating' }); 
  } else if (lMACD > lSig) {
    bullScore += 3; breakdown.momentum.score += 3;
    breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD above signal' });
  } else {
    bearScore += 3; breakdown.momentum.score -= 3;
    breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD below signal' });
  }
  
  // Volume accumulation
  if (volume.accumulationScore >= 5) {
    bullScore += 6; breakdown.momentum.score += 6;
    breakdown.momentum.signals.push({ type: 'bullish', text: 'Volume accumulation' });
  } else if (volume.accumulationScore <= -5) {
    bearScore += 6; breakdown.momentum.score -= 6;
    breakdown.momentum.signals.push({ type: 'bearish', text: 'Volume distribution' });
  }
  
  // ============ CONFLUENCE (20 pts) ============
  if (refBias === 'LONG') { 
    bullScore += 10; breakdown.confluence.score += 10; 
    breakdown.confluence.signals.push({ type: 'bullish', text: 'Reference asset bullish ✓' }); 
  } else if (refBias === 'SHORT') { 
    bearScore += 10; breakdown.confluence.score -= 10; 
    breakdown.confluence.signals.push({ type: 'bearish', text: 'Reference asset bearish ✓' }); 
  }
  
  const fundingPct = funding * 100;
  if (fundingPct > 0.05) { 
    bearScore += 6; breakdown.confluence.score -= 6; 
    breakdown.confluence.signals.push({ type: 'bearish', text: `High funding ${fundingPct.toFixed(3)}% (crowded long)` }); 
  } else if (fundingPct < -0.03) { 
    bullScore += 6; breakdown.confluence.score += 6; 
    breakdown.confluence.signals.push({ type: 'bullish', text: `Neg funding ${fundingPct.toFixed(3)}%` }); 
  }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  
  let bias = 'NEUTRAL'; 
  if (totalScore >= 20) bias = 'LONG'; 
  else if (totalScore <= -20) bias = 'SHORT';
  
  // ============ ENTRY QUALITY FOR BIG MOVES ============
  let entryQuality = 'NONE';
  let qualityReasons = [];
  let swingReady = false;
  
  if (bias !== 'NEUTRAL') {
    let qualityScore = 0;
    
    if (bias === 'LONG') {
      if (breakout.bullishBreakout) { qualityScore += 3; qualityReasons.push('Breakout'); }
      if (volume.climax || (volume.expanding && volume.relative > 2)) { qualityScore += 3; qualityReasons.push('Volume surge'); }
      if (trend.direction === 'bullish' && trend.strength > 60) { qualityScore += 2; qualityReasons.push('Strong trend'); }
      if (lADX > 25) { qualityScore += 2; qualityReasons.push('ADX trending'); }
      if (le20 > le50 && le50 > le200) { qualityScore += 2; qualityReasons.push('EMA aligned'); }
      if (lRSI > 50 && lRSI < 75) { qualityScore += 1; qualityReasons.push('RSI room'); }
      if (refBias === 'LONG') { qualityScore += 2; qualityReasons.push('BTC aligned'); }
      if (lMACD > lSig && lHist > 0) { qualityScore += 1; qualityReasons.push('MACD +'); }
    } else {
      if (breakout.bearishBreakout) { qualityScore += 3; qualityReasons.push('Breakdown'); }
      if (volume.climax || (volume.expanding && volume.relative > 2)) { qualityScore += 3; qualityReasons.push('Volume surge'); }
      if (trend.direction === 'bearish' && trend.strength > 60) { qualityScore += 2; qualityReasons.push('Strong trend'); }
      if (lADX > 25) { qualityScore += 2; qualityReasons.push('ADX trending'); }
      if (le20 < le50 && le50 < le200) { qualityScore += 2; qualityReasons.push('EMA aligned'); }
      if (lRSI < 50 && lRSI > 25) { qualityScore += 1; qualityReasons.push('RSI room'); }
      if (refBias === 'SHORT') { qualityScore += 2; qualityReasons.push('BTC aligned'); }
      if (lMACD < lSig && lHist < 0) { qualityScore += 1; qualityReasons.push('MACD -'); }
    }
    
    if (qualityScore >= 10) { entryQuality = 'A+'; swingReady = true; }
    else if (qualityScore >= 7) { entryQuality = 'A'; swingReady = true; }
    else if (qualityScore >= 5) entryQuality = 'B';
    else if (qualityScore >= 3) entryQuality = 'C';
  }
  
  // Filters
  let shouldTrade = swingReady;
  let noTradeReason = '';
  if (lADX < 20 && !breakout.bullishBreakout && !breakout.bearishBreakout) { shouldTrade = false; noTradeReason = 'No trend, no breakout'; }
  if (volume.relative < 1.0 && !breakout.bullishBreakout && !breakout.bearishBreakout) { shouldTrade = false; noTradeReason = 'Low volume'; }
  if (Math.abs(totalScore) < 25) { shouldTrade = false; noTradeReason = 'Weak conviction'; }
  
  // ============ SWING TRADE PLAN - BIGGER TARGETS ============
  let tradePlan = null;
  if (bias !== 'NEUTRAL') {
    const price = latest.close;
    
    if (bias === 'LONG') {
      const entry = price;
      // Wider stop below structure
      const stopLoss = Math.min(consolidation.support - lATR * 0.5, le50 - lATR);
      const risk = entry - stopLoss;
      const riskPercent = (risk / entry) * 100;
      
      tradePlan = {
        direction: 'LONG',
        entry,
        stopLoss,
        // Big targets for 40%+ moves (with leverage)
        tp1: entry + risk * 3,   // 3R
        tp2: entry + risk * 5,   // 5R  
        tp3: entry + risk * 8,   // 8R
        tp4: entry + risk * 12,  // 12R (let it run)
        trailStop: entry + risk * 1.5, // Start trailing after 1.5R
        riskPercent: riskPercent.toFixed(2),
        riskR: risk,
        potentialGain: `${(riskPercent * 5).toFixed(1)}% - ${(riskPercent * 12).toFixed(1)}%`,
        leverage: `10x = ${(riskPercent * 10 * 5).toFixed(0)}% - ${(riskPercent * 10 * 12).toFixed(0)}%`,
        atr: lATR
      };
    } else {
      const entry = price;
      const stopLoss = Math.max(consolidation.resistance + lATR * 0.5, le50 + lATR);
      const risk = stopLoss - entry;
      const riskPercent = (risk / entry) * 100;
      
      tradePlan = {
        direction: 'SHORT',
        entry,
        stopLoss,
        tp1: entry - risk * 3,
        tp2: entry - risk * 5,
        tp3: entry - risk * 8,
        tp4: entry - risk * 12,
        trailStop: entry - risk * 1.5,
        riskPercent: riskPercent.toFixed(2),
        riskR: risk,
        potentialGain: `${(riskPercent * 5).toFixed(1)}% - ${(riskPercent * 12).toFixed(1)}%`,
        leverage: `10x = ${(riskPercent * 10 * 5).toFixed(0)}% - ${(riskPercent * 10 * 12).toFixed(0)}%`,
        atr: lATR
      };
    }
  }
  
  return { 
    bias, 
    confidence: Math.min(Math.abs(totalScore), 100).toFixed(0), 
    bullScore, bearScore, signals, breakdown, shouldTrade, noTradeReason, tradePlan, score: totalScore,
    consolidation, breakout, volume, trend, entryQuality, qualityReasons, swingReady,
    indicators: { rsi: lRSI, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, ema20: le20, ema50: le50, bbWidth: lBB.width * 100, price: latest.close } 
  };
};

// ============ SWING BACKTEST - TRAILING STOPS ============
const runSwingBacktest = (data, initialCapital = 10000) => {
  if (data.length < 100) return null;
  
  const trades = [];
  let position = null;
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  let skippedTrades = 0;
  
  for (let i = 50; i < data.length - 1; i++) {
    const slice = data.slice(0, i + 1);
    const analysis = analyzeSwingSignals(slice, 0, 'NEUTRAL');
    const currentCandle = data[i];
    const nextCandle = data[i + 1];
    
    // Exit logic with trailing stop
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      // Update trailing stop
      if (position.direction === 'LONG') {
        const unrealizedR = (nextCandle.high - position.entry) / position.riskR;
        if (unrealizedR > 1.5 && !position.trailing) {
          position.trailing = true;
          position.stopLoss = position.entry + position.riskR * 0.5; // Lock in 0.5R
        }
        if (position.trailing) {
          // Trail stop at 2 ATR below recent high
          const newTrail = Math.max(...data.slice(i - 5, i + 1).map(d => d.high)) - position.atr * 2;
          if (newTrail > position.stopLoss) position.stopLoss = newTrail;
        }
        
        // Check exits
        if (nextCandle.low <= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = position.trailing ? 'Trail Stop' : 'Stop'; 
        }
        else if (nextCandle.high >= position.tp3) { 
          exitPrice = position.tp3; 
          exitReason = 'TP3 (8R)'; 
        }
        else if (analysis.bias === 'SHORT' && analysis.score <= -25) { 
          exitPrice = nextCandle.open; 
          exitReason = 'Reversal'; 
        }
      } else { // SHORT
        const unrealizedR = (position.entry - nextCandle.low) / position.riskR;
        if (unrealizedR > 1.5 && !position.trailing) {
          position.trailing = true;
          position.stopLoss = position.entry - position.riskR * 0.5;
        }
        if (position.trailing) {
          const newTrail = Math.min(...data.slice(i - 5, i + 1).map(d => d.low)) + position.atr * 2;
          if (newTrail < position.stopLoss) position.stopLoss = newTrail;
        }
        
        if (nextCandle.high >= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = position.trailing ? 'Trail Stop' : 'Stop'; 
        }
        else if (nextCandle.low <= position.tp3) { 
          exitPrice = position.tp3; 
          exitReason = 'TP3 (8R)'; 
        }
        else if (analysis.bias === 'LONG' && analysis.score >= 25) { 
          exitPrice = nextCandle.open; 
          exitReason = 'Reversal'; 
        }
      }
      
      // Max hold 100 candles (longer for swing)
      if (!exitPrice && i - position.entryIndex > 100) { 
        exitPrice = nextCandle.close; 
        exitReason = 'Time'; 
      }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' 
          ? (exitPrice - position.entry) * position.size 
          : (position.entry - exitPrice) * position.size;
        const rMultiple = pnl / (position.riskR * position.size);
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
    
    // Entry - only A+ and A setups
    if (!position && analysis.tradePlan && analysis.swingReady) {
      const validEntry = 
        analysis.shouldTrade &&
        Math.abs(analysis.score) >= 25 &&
        (analysis.entryQuality === 'A+' || analysis.entryQuality === 'A');
      
      if (validEntry) {
        const plan = analysis.tradePlan;
        const riskPerTrade = capital * 0.02; // 2% risk for swing
        const stopDistance = Math.abs(currentCandle.close - plan.stopLoss);
        const positionSize = riskPerTrade / stopDistance;
        
        position = {
          direction: plan.direction,
          entry: currentCandle.close,
          stopLoss: plan.stopLoss,
          originalStop: plan.stopLoss,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp3: plan.tp3,
          riskR: plan.riskR,
          atr: plan.atr,
          trailing: false,
          entryIndex: i,
          size: positionSize,
          quality: analysis.entryQuality
        };
      } else if (Math.abs(analysis.score) >= 20) {
        skippedTrades++;
      }
    }
  }
  
  // Close open position
  if (position) {
    const lastPrice = data[data.length - 1].close;
    const pnl = position.direction === 'LONG' 
      ? (lastPrice - position.entry) * position.size 
      : (position.entry - lastPrice) * position.size;
    const rMultiple = pnl / (position.riskR * position.size);
    trades.push({ 
      direction: position.direction, entry: position.entry, exit: lastPrice, 
      pnl, pnlPercent: rMultiple, reason: 'End', duration: data.length - position.entryIndex, quality: position.quality 
    });
    capital += pnl;
  }
  
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const avgDuration = trades.length > 0 ? (trades.reduce((a, t) => a + t.duration, 0) / trades.length).toFixed(0) : 0;
  const bigWins = trades.filter(t => t.pnlPercent >= 3).length;
  
  return {
    totalTrades: trades.length, winningTrades: wins.length, losingTrades: losses.length, skippedTrades, bigWins,
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
  <div style={{ background: highlight ? 'rgba(16,185,129,0.15)' : '#0a0a0a', border: `1px solid ${highlight ? '#10b981' : '#1a1a1a'}`, padding: '8px', textAlign: 'center' }}>
    <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px' }}>{label}</div>
    <div style={{ fontSize: '14px', fontWeight: '600', color }}>{value}</div>
  </div>
);

const SignalBox = ({ analysis, timeframe }) => (
  <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '12px', textAlign: 'center' }}>
    <div style={{ fontSize: '9px', color: '#888', letterSpacing: '1px', marginBottom: '4px' }}>{timeframe}</div>
    <div style={{ fontSize: '32px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis.bias}</div>
    <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>{analysis.score > 0 ? '+' : ''}{analysis.score} pts • {analysis.confidence}%</div>
    {analysis.swingReady && (
      <div style={{ marginTop: '6px', background: analysis.entryQuality === 'A+' ? '#10b981' : '#3b82f6', color: '#000', padding: '4px 10px', fontSize: '11px', fontWeight: '700', display: 'inline-block' }}>
        {analysis.entryQuality} SETUP
      </div>
    )}
  </div>
);

// ============ ASSET PAGE ============
const AssetPage = ({ symbol, name, data5m, data15m, refData, funding, refName }) => {
  const [backtest, setBacktest] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  
  const refAnalysis = useMemo(() => analyzeSwingSignals(refData, 0, 'NEUTRAL'), [refData]);
  const analysis5m = useMemo(() => analyzeSwingSignals(data5m, funding, refAnalysis.bias), [data5m, funding, refAnalysis.bias]);
  const analysis15m = useMemo(() => analyzeSwingSignals(data15m, funding, refAnalysis.bias), [data15m, funding, refAnalysis.bias]);
  
  // Both timeframes should agree for big moves
  const mtfConfirmed = analysis5m.bias !== 'NEUTRAL' && analysis15m.bias === analysis5m.bias;
  
  const handleRunBacktest = () => {
    const result = runSwingBacktest(data5m);
    setBacktest(result);
    setShowBacktest(true);
  };
  
  const isSwingSetup = analysis5m.swingReady && mtfConfirmed;
  const price = data5m.length > 0 ? data5m[data5m.length - 1].close : 0;
  const priceChange = data5m.length > 1 ? ((data5m[data5m.length - 1].close - data5m[0].close) / data5m[0].close) * 100 : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px', fontWeight: '700' }}>{name} SWING</span>
          {isSwingSetup && <span style={{ background: '#10b981', color: '#000', padding: '3px 10px', fontSize: '10px', fontWeight: '700', animation: 'pulse 1s infinite' }}>⚡ {analysis5m.entryQuality} SETUP</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '20px', fontWeight: '600' }}>${price?.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '11px' }}>{priceChange >= 0 ? '▲' : '▼'}{Math.abs(priceChange).toFixed(2)}% (500 candles)</span>
        </div>
      </div>
      
      {/* BIG MOVE ALERT */}
      {isSwingSetup && (
        <div style={{ background: analysis5m.bias === 'LONG' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)', border: `2px solid ${analysis5m.bias === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '15px', marginBottom: '10px', textAlign: 'center' }}>
          <div style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '18px' }}>
            🚀 HIGH CONVICTION {analysis5m.bias}
          </div>
          <div style={{ color: '#fff', fontSize: '12px', marginTop: '6px' }}>
            {analysis5m.qualityReasons?.join(' • ')}
          </div>
          {analysis5m.tradePlan && (
            <div style={{ color: '#888', fontSize: '11px', marginTop: '6px' }}>
              Potential: {analysis5m.tradePlan.leverage}
            </div>
          )}
        </div>
      )}
      
      {/* Breakout Alert */}
      {(analysis5m.breakout?.bullishBreakout || analysis5m.breakout?.bearishBreakout) && (
        <div style={{ background: analysis5m.breakout.bullishBreakout ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', border: `1px solid ${analysis5m.breakout.bullishBreakout ? '#10b981' : '#ef4444'}`, padding: '10px', marginBottom: '10px', textAlign: 'center' }}>
          <span style={{ color: analysis5m.breakout.bullishBreakout ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '14px' }}>
            🔥 {analysis5m.breakout.bullishBreakout ? 'BREAKOUT' : 'BREAKDOWN'} DETECTED
          </span>
        </div>
      )}
      
      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div style={{ background: '#0a0a0a', border: `2px solid ${analysis5m.swingReady ? '#10b981' : '#1a1a1a'}`, padding: '6px' }}>
          <div style={{ fontSize: '10px', color: analysis5m.swingReady ? '#10b981' : '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontWeight: '600' }}>
            <span>5M</span>
            <span>{analysis5m.bias} [{analysis5m.entryQuality}] ({analysis5m.score > 0 ? '+' : ''}{analysis5m.score})</span>
          </div>
          <Chart interval="5m" symbol={symbol} />
        </div>
        <div style={{ background: '#0a0a0a', border: `2px solid ${analysis15m.swingReady ? '#10b981' : '#1a1a1a'}`, padding: '6px' }}>
          <div style={{ fontSize: '10px', color: analysis15m.swingReady ? '#10b981' : '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontWeight: '600' }}>
            <span>15M</span>
            <span>{analysis15m.bias} [{analysis15m.entryQuality}] ({analysis15m.score > 0 ? '+' : ''}{analysis15m.score})</span>
          </div>
          <Chart interval="15m" symbol={symbol} />
        </div>
      </div>
      
      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            <StatBox label="TREND" value={analysis5m.trend?.direction?.toUpperCase().slice(0,4) || 'NEUT'} color={analysis5m.trend?.direction === 'bullish' ? '#10b981' : analysis5m.trend?.direction === 'bearish' ? '#ef4444' : '#666'} highlight={analysis5m.trend?.strength > 60} />
            <StatBox label="STRENGTH" value={`${analysis5m.trend?.strength?.toFixed(0) || 0}%`} color={analysis5m.trend?.strength > 60 ? '#10b981' : '#666'} />
            <StatBox label="VOLUME" value={`${analysis5m.volume?.relative?.toFixed(1) || '1.0'}x`} color={analysis5m.volume?.climax ? '#10b981' : analysis5m.volume?.relative > 1.5 ? '#3b82f6' : '#666'} highlight={analysis5m.volume?.climax} />
            <StatBox label="ADX" value={analysis5m.indicators?.adx?.toFixed(0) || '--'} color={analysis5m.indicators?.adx > 30 ? '#10b981' : analysis5m.indicators?.adx > 20 ? '#3b82f6' : '#666'} />
            <StatBox label={refName} value={refAnalysis.bias} color={refAnalysis.bias === 'LONG' ? '#10b981' : refAnalysis.bias === 'SHORT' ? '#ef4444' : '#666'} />
            <StatBox label="QUALITY" value={analysis5m.entryQuality || 'NONE'} color={analysis5m.entryQuality === 'A+' ? '#10b981' : analysis5m.entryQuality === 'A' ? '#3b82f6' : '#666'} />
          </div>
          
          {/* Signal Boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <SignalBox analysis={analysis5m} timeframe="5M" />
            <SignalBox analysis={analysis15m} timeframe="15M" />
            <SignalBox analysis={refAnalysis} timeframe={refName} />
          </div>
          
          {/* MTF Status */}
          {mtfConfirmed && (
            <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', padding: '10px', textAlign: 'center' }}>
              <span style={{ color: '#10b981', fontWeight: '700', fontSize: '12px' }}>✓ MTF CONFIRMED — 5M & 15M Aligned</span>
            </div>
          )}
          
          {analysis5m.bias !== 'NEUTRAL' && analysis15m.bias !== 'NEUTRAL' && analysis5m.bias !== analysis15m.bias && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', padding: '10px', textAlign: 'center' }}>
              <span style={{ color: '#ef4444', fontWeight: '700', fontSize: '12px' }}>⚠ TIMEFRAME CONFLICT — Wait for alignment</span>
            </div>
          )}
          
          {/* SWING TRADE PLAN */}
          {analysis5m.tradePlan && analysis5m.shouldTrade && (
            <div style={{ background: analysis5m.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `2px solid ${analysis5m.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#888', letterSpacing: '1px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                <span>SWING TRADE — {analysis5m.tradePlan.direction}</span>
                <span style={{ color: '#f59e0b' }}>Target: 3R - 8R+</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '8px', color: '#666' }}>ENTRY</div>
                  <div style={{ fontSize: '14px', color: '#fff', fontWeight: '600' }}>${analysis5m.tradePlan.entry.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#666' }}>STOP LOSS</div>
                  <div style={{ fontSize: '14px', color: '#ef4444', fontWeight: '600' }}>${analysis5m.tradePlan.stopLoss.toFixed(symbol === 'BTCUSDT' ? 0 : 3)}</div>
                  <div style={{ fontSize: '9px', color: '#666' }}>Risk: {analysis5m.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#666' }}>TARGETS</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>TP1 (3R): ${analysis5m.tradePlan.tp1.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>TP2 (5R): ${analysis5m.tradePlan.tp2.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>TP3 (8R): ${analysis5m.tradePlan.tp3.toFixed(symbol === 'BTCUSDT' ? 0 : 2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#666' }}>POTENTIAL (10x)</div>
                  <div style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700' }}>{analysis5m.tradePlan.leverage.split('=')[1]}</div>
                  <div style={{ fontSize: '8px', color: '#666', marginTop: '4px' }}>Trail after 1.5R</div>
                </div>
              </div>
            </div>
          )}
          
          {!analysis5m.shouldTrade && analysis5m.noTradeReason && (
            <div style={{ background: 'rgba(100,100,100,0.1)', border: '1px solid #444', padding: '10px' }}>
              <span style={{ color: '#888', fontWeight: '600', fontSize: '10px' }}>⏳ WAITING: </span>
              <span style={{ color: '#666', fontSize: '10px' }}>{analysis5m.noTradeReason}</span>
            </div>
          )}
          
          {/* Consolidation Info */}
          {analysis5m.consolidation?.inConsolidation && (
            <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', padding: '10px' }}>
              <div style={{ color: '#3b82f6', fontWeight: '600', fontSize: '11px', marginBottom: '6px' }}>📊 CONSOLIDATION DETECTED</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '10px' }}>
                <div><span style={{ color: '#666' }}>Resistance:</span> <span style={{ color: '#ef4444' }}>${analysis5m.consolidation.resistance.toFixed(2)}</span></div>
                <div><span style={{ color: '#666' }}>Support:</span> <span style={{ color: '#10b981' }}>${analysis5m.consolidation.support.toFixed(2)}</span></div>
                <div><span style={{ color: '#666' }}>Range:</span> <span style={{ color: '#fff' }}>{analysis5m.consolidation.rangeSize.toFixed(1)}%</span></div>
              </div>
            </div>
          )}
          
          {/* Backtest */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={handleRunBacktest} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 20px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST SWING (5M)</button>
            <span style={{ fontSize: '9px', color: '#666' }}>A/A+ setups • Trailing stops • 3-8R targets</span>
          </div>
          
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px' }}>SWING BACKTEST</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px', marginBottom: '10px' }}>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>WIN%</div><div style={{ fontSize: '13px', color: parseFloat(backtest.winRate) >= 50 ? '#10b981' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>TRADES</div><div style={{ fontSize: '13px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>BIG WINS</div><div style={{ fontSize: '13px', color: '#10b981' }}>{backtest.bigWins}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>P&L</div><div style={{ fontSize: '13px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>DD</div><div style={{ fontSize: '13px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>PF</div><div style={{ fontSize: '13px', color: parseFloat(backtest.profitFactor) > 1.5 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>EXPECT</div><div style={{ fontSize: '13px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>AVG DUR</div><div style={{ fontSize: '13px', color: '#888' }}>{backtest.avgDuration}</div></div>
              </div>
              <div style={{ maxHeight: '140px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 20px 1fr 60px 30px 50px', padding: '3px 0', borderBottom: '1px solid #1a1a1a', fontSize: '9px', alignItems: 'center' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: t.quality === 'A+' ? '#10b981' : '#3b82f6', fontWeight: '600' }}>{t.quality}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(1)}→${t.exit.toFixed(1)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
                    <span style={{ color: '#888' }}>{t.duration}</span>
                    <span style={{ color: t.pnl > 0 ? '#10b981' : '#ef4444', textAlign: 'right', fontWeight: t.pnlPercent >= 3 ? '700' : '400' }}>{t.pnlPercent > 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}R</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '8px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <Badge label="RSI" value={analysis5m.indicators?.rsi?.toFixed(0) || '--'} status={analysis5m.indicators?.rsi > 60 ? 'bullish' : analysis5m.indicators?.rsi < 40 ? 'bearish' : 'neutral'} />
              <Badge label="MACD" value={analysis5m.indicators?.macd?.toFixed(2) || '--'} status={analysis5m.indicators?.macd > analysis5m.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="EMA20" value={`$${analysis5m.indicators?.ema20?.toFixed(2) || '--'}`} status={analysis5m.indicators?.price > analysis5m.indicators?.ema20 ? 'bullish' : 'bearish'} />
              <Badge label="EMA50" value={`$${analysis5m.indicators?.ema50?.toFixed(2) || '--'}`} status={analysis5m.indicators?.price > analysis5m.indicators?.ema50 ? 'bullish' : 'bearish'} />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '8px' }}>BREAKDOWN</div>
            {Object.entries(analysis5m.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginBottom: '2px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}/{c.max}</span>
                </div>
                <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>SIGNALS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {(analysis5m.signals || []).slice(0, 12).map((s, i) => (
                <div key={i} style={{ fontSize: '9px', padding: '3px 5px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
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
  const [solData15m, setSolData15m] = useState([]);
  const [solFunding, setSolFunding] = useState(0);
  
  const [btcData5m, setBtcData5m] = useState([]);
  const [btcData15m, setBtcData15m] = useState([]);
  const [btcFunding, setBtcFunding] = useState(0);
  
  const [ethData5m, setEthData5m] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [solRes5m, solRes15m, btcRes5m, btcRes15m, ethRes5m] = await Promise.all([
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=15m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=300'),
          fetch('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=5m&limit=200')
        ]);
        
        const parse = (klines) => klines.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        
        const [solK5m, solK15m, btcK5m, btcK15m, ethK5m] = await Promise.all([
          solRes5m.json(), solRes15m.json(), btcRes5m.json(), btcRes15m.json(), ethRes5m.json()
        ]);
        
        setSolData5m(parse(solK5m));
        setSolData15m(parse(solK15m));
        setBtcData5m(parse(btcK5m));
        setBtcData15m(parse(btcK15m));
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
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING SWING DASHBOARD...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '10px' }}>
      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button onClick={() => setActiveTab('SOL')} style={{ background: activeTab === 'SOL' ? '#10b981' : '#1a1a1a', color: activeTab === 'SOL' ? '#000' : '#888', border: 'none', padding: '10px 24px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>SOL SWING</button>
        <button onClick={() => setActiveTab('BTC')} style={{ background: activeTab === 'BTC' ? '#f59e0b' : '#1a1a1a', color: activeTab === 'BTC' ? '#000' : '#888', border: 'none', padding: '10px 24px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px' }}>BTC SWING</button>
      </div>
      
      {activeTab === 'SOL' && (
        <AssetPage symbol="SOLUSDT" name="SOL" data5m={solData5m} data15m={solData15m} refData={btcData5m} funding={solFunding} refName="BTC" />
      )}
      {activeTab === 'BTC' && (
        <AssetPage symbol="BTCUSDT" name="BTC" data5m={btcData5m} data15m={btcData15m} refData={ethData5m} funding={btcFunding} refName="ETH" />
      )}
      
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#444' }}>
        <div>SWING MODE • 5M+15M • Breakout Detection • Trailing Stops • 5s refresh • {update?.toLocaleTimeString()}</div>
        <div>NFA DYOR</div>
      </div>
      
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
    </div>
  );
}
