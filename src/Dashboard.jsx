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
        height: 280,
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

      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`);
        const data = await res.json();
        const candles = data.map(d => ({ time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]) }));
        candleSeries.setData(candles);

        const calcEMA = (data, period) => {
          const k = 2 / (period + 1); let ema = data[0].close;
          return data.map((d, i) => { if (i === 0) return { time: d.time, value: ema }; ema = d.close * k + ema * (1 - k); return { time: d.time, value: ema }; });
        };
        ema9.setData(calcEMA(candles, 9));
        ema21.setData(calcEMA(candles, 21));
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

// ============ INDICATOR CALCULATIONS ============
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

const calcStochRSI = (data) => {
  const rsi = calcRSI(data, 14);
  const stochK = rsi.map((r, i) => {
    if (i < 14) return 50;
    const slice = rsi.slice(i - 13, i + 1), min = Math.min(...slice), max = Math.max(...slice);
    return max === min ? 50 : ((r - min) / (max - min)) * 100;
  });
  const smoothK = stochK.map((_, i) => i < 3 ? stochK[i] : stochK.slice(i - 2, i + 1).reduce((a, b) => a + b, 0) / 3);
  return { k: smoothK };
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

const calcBB = (data, period = 20, mult = 2) => data.map((_, i) => {
  if (i < period - 1) return { upper: data[i].close, lower: data[i].close, middle: data[i].close, width: 0 };
  const slice = data.slice(i - period + 1, i + 1), sma = slice.reduce((a, b) => a + b.close, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b.close - sma, 2), 0) / period);
  return { upper: sma + mult * std, lower: sma - mult * std, middle: sma, width: (mult * std * 2) / sma };
});

// ============ NEW: DIVERGENCE DETECTION ============
const detectDivergence = (data, rsi, lookback = 10) => {
  if (data.length < lookback + 5) return { bullish: false, bearish: false };
  
  const recentData = data.slice(-lookback);
  const recentRSI = rsi.slice(-lookback);
  
  // Find local highs/lows in price
  let priceHighIdx = 0, priceLowIdx = 0;
  for (let i = 1; i < recentData.length; i++) {
    if (recentData[i].high > recentData[priceHighIdx].high) priceHighIdx = i;
    if (recentData[i].low < recentData[priceLowIdx].low) priceLowIdx = i;
  }
  
  // Compare current vs previous swing
  const prevData = data.slice(-lookback * 2, -lookback);
  const prevRSI = rsi.slice(-lookback * 2, -lookback);
  
  let prevHighIdx = 0, prevLowIdx = 0;
  for (let i = 1; i < prevData.length; i++) {
    if (prevData[i].high > prevData[prevHighIdx].high) prevHighIdx = i;
    if (prevData[i].low < prevData[prevLowIdx].low) prevLowIdx = i;
  }
  
  // Bearish divergence: Price higher high, RSI lower high
  const bearishDiv = recentData[priceHighIdx].high > prevData[prevHighIdx].high && 
                     recentRSI[priceHighIdx] < prevRSI[prevHighIdx] - 3;
  
  // Bullish divergence: Price lower low, RSI higher low
  const bullishDiv = recentData[priceLowIdx].low < prevData[prevLowIdx].low && 
                     recentRSI[priceLowIdx] > prevRSI[prevLowIdx] + 3;
  
  return { bullish: bullishDiv, bearish: bearishDiv };
};

// ============ NEW: MARKET STRUCTURE ============
const detectMarketStructure = (data, lookback = 20) => {
  if (data.length < lookback) return { structure: 'unknown', swings: [] };
  
  const recent = data.slice(-lookback);
  const swings = [];
  
  // Find swing highs and lows
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
  
  // Analyze structure
  const highs = swings.filter(s => s.type === 'high').map(s => s.price);
  const lows = swings.filter(s => s.type === 'low').map(s => s.price);
  
  let structure = 'ranging';
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1] > highs[highs.length - 2];
    const hl = lows[lows.length - 1] > lows[lows.length - 2];
    const lh = highs[highs.length - 1] < highs[highs.length - 2];
    const ll = lows[lows.length - 1] < lows[lows.length - 2];
    
    if (hh && hl) structure = 'uptrend';
    else if (lh && ll) structure = 'downtrend';
    else if (hh && ll) structure = 'expanding';
    else if (lh && hl) structure = 'contracting';
  }
  
  return { structure, swings, highs, lows };
};

// ============ NEW: VOLUME ANALYSIS ============
const analyzeVolume = (data, period = 20) => {
  if (data.length < period) return { relative: 1, trend: 'neutral', spike: false };
  
  const recent = data.slice(-period);
  const avgVolume = recent.reduce((a, b) => a + b.volume, 0) / period;
  const currentVolume = data[data.length - 1].volume;
  const relative = currentVolume / avgVolume;
  
  // Volume trend (is volume increasing on up moves?)
  let upVolume = 0, downVolume = 0, upCount = 0, downCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close > recent[i-1].close) { upVolume += recent[i].volume; upCount++; }
    else { downVolume += recent[i].volume; downCount++; }
  }
  
  const avgUpVol = upCount > 0 ? upVolume / upCount : 0;
  const avgDownVol = downCount > 0 ? downVolume / downCount : 0;
  
  let trend = 'neutral';
  if (avgUpVol > avgDownVol * 1.3) trend = 'bullish';
  else if (avgDownVol > avgUpVol * 1.3) trend = 'bearish';
  
  return { relative, trend, spike: relative > 2, avgVolume, currentVolume };
};

// ============ MAIN SIGNAL ANALYSIS ============
const analyzeSignals = (data, funding = 0, oi = 0, oiChange = 0, btcBias = 'NEUTRAL') => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null, score: 0 };
  
  const latest = data[data.length - 1], prev = data[data.length - 2];
  const ema9 = calcEMA(data, 9), ema21 = calcEMA(data, 21), ema50 = calcEMA(data, 50);
  const rsi = calcRSI(data), stochRSI = calcStochRSI(data);
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data), bb = calcBB(data);
  
  // New analyses
  const divergence = detectDivergence(data, rsi);
  const structure = detectMarketStructure(data);
  const volume = analyzeVolume(data);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { 
    trend: { score: 0, max: 30, signals: [] }, 
    momentum: { score: 0, max: 30, signals: [] }, 
    structure: { score: 0, max: 25, signals: [] },
    volume: { score: 0, max: 20, signals: [] },
    confluence: { score: 0, max: 25, signals: [] }
  };
  
  const le9 = ema9[ema9.length - 1], le21 = ema21[ema21.length - 1], le50 = ema50[ema50.length - 1];
  const pe9 = ema9[ema9.length - 2], pe21 = ema21[ema21.length - 2];
  
  // TREND
  if (le9 > le21 && le21 > le50) { bullScore += 12; breakdown.trend.score += 12; breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs bullish stack' }); }
  else if (le9 < le21 && le21 < le50) { bearScore += 12; breakdown.trend.score -= 12; breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs bearish stack' }); }
  else if (le9 > le21) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: '9 > 21 EMA' }); }
  else if (le9 < le21) { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: '9 < 21 EMA' }); }
  
  if (latest.close > le9) { bullScore += 4; breakdown.trend.score += 4; breakdown.trend.signals.push({ type: 'bullish', text: 'Price > EMA9' }); }
  else { bearScore += 4; breakdown.trend.score -= 4; breakdown.trend.signals.push({ type: 'bearish', text: 'Price < EMA9' }); }
  
  if (pe9 <= pe21 && le9 > le21) { bullScore += 10; breakdown.trend.score += 10; breakdown.trend.signals.push({ type: 'bullish', text: '🔥 Golden cross!' }); }
  if (pe9 >= pe21 && le9 < le21) { bearScore += 10; breakdown.trend.score -= 10; breakdown.trend.signals.push({ type: 'bearish', text: '🔥 Death cross!' }); }
  
  const lADX = adx[adx.length - 1], lPlus = plusDI[plusDI.length - 1], lMinus = minusDI[minusDI.length - 1];
  if (lADX > 25) { 
    if (lPlus > lMinus) { bullScore += 6; breakdown.trend.score += 6; breakdown.trend.signals.push({ type: 'bullish', text: `ADX ${lADX.toFixed(0)} +DI leading` }); } 
    else { bearScore += 6; breakdown.trend.score -= 6; breakdown.trend.signals.push({ type: 'bearish', text: `ADX ${lADX.toFixed(0)} -DI leading` }); } 
  }
  
  // MOMENTUM
  const lRSI = rsi[rsi.length - 1], lStochK = stochRSI.k[stochRSI.k.length - 1];
  const lMACD = macd[macd.length - 1], lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1], pHist = histogram[histogram.length - 2];
  
  if (lRSI < 30) { bullScore += 10; breakdown.momentum.score += 10; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold ${lRSI.toFixed(0)}` }); }
  else if (lRSI > 70) { bearScore += 10; breakdown.momentum.score -= 10; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought ${lRSI.toFixed(0)}` }); }
  else if (lRSI > 55) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI ${lRSI.toFixed(0)} bullish` }); }
  else if (lRSI < 45) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI ${lRSI.toFixed(0)} bearish` }); }
  
  if (lStochK < 20) { bullScore += 8; breakdown.momentum.score += 8; breakdown.momentum.signals.push({ type: 'bullish', text: 'Stoch oversold' }); }
  else if (lStochK > 80) { bearScore += 8; breakdown.momentum.score -= 8; breakdown.momentum.signals.push({ type: 'bearish', text: 'Stoch overbought' }); }
  
  const pMACD = macd[macd.length - 2], pSig = macdSig[macdSig.length - 2];
  if (pMACD <= pSig && lMACD > lSig) { bullScore += 8; breakdown.momentum.score += 8; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD cross ↑' }); }
  if (pMACD >= pSig && lMACD < lSig) { bearScore += 8; breakdown.momentum.score -= 8; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD cross ↓' }); }
  
  if (lMACD > lSig) { bullScore += 3; breakdown.momentum.score += 3; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD > Signal' }); }
  else { bearScore += 3; breakdown.momentum.score -= 3; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD < Signal' }); }
  
  // DIVERGENCE (High impact!)
  if (divergence.bullish) { bullScore += 15; breakdown.momentum.score += 15; breakdown.momentum.signals.push({ type: 'bullish', text: '🎯 Bullish divergence!' }); }
  if (divergence.bearish) { bearScore += 15; breakdown.momentum.score -= 15; breakdown.momentum.signals.push({ type: 'bearish', text: '🎯 Bearish divergence!' }); }
  
  // MARKET STRUCTURE
  if (structure.structure === 'uptrend') { bullScore += 12; breakdown.structure.score += 12; breakdown.structure.signals.push({ type: 'bullish', text: 'HH + HL (uptrend)' }); }
  else if (structure.structure === 'downtrend') { bearScore += 12; breakdown.structure.score -= 12; breakdown.structure.signals.push({ type: 'bearish', text: 'LH + LL (downtrend)' }); }
  else if (structure.structure === 'contracting') { breakdown.structure.signals.push({ type: 'neutral', text: 'Contracting range' }); }
  else if (structure.structure === 'expanding') { breakdown.structure.signals.push({ type: 'neutral', text: 'Expanding volatility' }); }
  
  // BB position
  const lBB = bb[bb.length - 1];
  if (latest.close <= lBB.lower) { bullScore += 8; breakdown.structure.score += 8; breakdown.structure.signals.push({ type: 'bullish', text: 'At lower BB' }); }
  else if (latest.close >= lBB.upper) { bearScore += 8; breakdown.structure.score -= 8; breakdown.structure.signals.push({ type: 'bearish', text: 'At upper BB' }); }
  
  // VOLUME
  if (volume.spike) {
    if (latest.close > prev.close) { bullScore += 10; breakdown.volume.score += 10; breakdown.volume.signals.push({ type: 'bullish', text: `Volume spike ${volume.relative.toFixed(1)}x (bullish)` }); }
    else { bearScore += 10; breakdown.volume.score -= 10; breakdown.volume.signals.push({ type: 'bearish', text: `Volume spike ${volume.relative.toFixed(1)}x (bearish)` }); }
  } else if (volume.relative > 1.3) {
    if (latest.close > prev.close) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'Above avg volume (up)' }); }
    else { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'Above avg volume (down)' }); }
  } else if (volume.relative < 0.7) {
    breakdown.volume.signals.push({ type: 'neutral', text: 'Low volume ⚠️' });
  }
  
  if (volume.trend === 'bullish') { bullScore += 6; breakdown.volume.score += 6; breakdown.volume.signals.push({ type: 'bullish', text: 'Volume favors buyers' }); }
  else if (volume.trend === 'bearish') { bearScore += 6; breakdown.volume.score -= 6; breakdown.volume.signals.push({ type: 'bearish', text: 'Volume favors sellers' }); }
  
  // CONFLUENCE - BTC Correlation
  if (btcBias === 'LONG') { bullScore += 8; breakdown.confluence.score += 8; breakdown.confluence.signals.push({ type: 'bullish', text: 'BTC bullish ✓' }); }
  else if (btcBias === 'SHORT') { bearScore += 8; breakdown.confluence.score -= 8; breakdown.confluence.signals.push({ type: 'bearish', text: 'BTC bearish ✓' }); }
  else { breakdown.confluence.signals.push({ type: 'neutral', text: 'BTC neutral' }); }
  
  // Funding
  const fundingPct = funding * 100;
  if (fundingPct > 0.03) { bearScore += 8; breakdown.confluence.score -= 8; breakdown.confluence.signals.push({ type: 'bearish', text: `High funding ${fundingPct.toFixed(3)}%` }); }
  else if (fundingPct < -0.03) { bullScore += 8; breakdown.confluence.score += 8; breakdown.confluence.signals.push({ type: 'bullish', text: `Neg funding ${fundingPct.toFixed(3)}%` }); }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  
  let bias = 'NEUTRAL'; 
  if (totalScore >= 10) bias = 'LONG'; 
  else if (totalScore <= -10) bias = 'SHORT';
  
  // Trade filters
  let shouldTrade = true;
  let noTradeReason = '';
  if (lADX < 15 && Math.abs(totalScore) < 20) { shouldTrade = false; noTradeReason = 'Weak trend + low conviction'; }
  if (lBB.width < 0.012) { shouldTrade = false; noTradeReason = 'BB squeeze - wait for breakout'; }
  if (volume.relative < 0.5) { shouldTrade = false; noTradeReason = 'Volume too low'; }
  
  // Trade plan
  let tradePlan = null;
  const lATR = atr[atr.length - 1];
  if (bias !== 'NEUTRAL') {
    const price = latest.close;
    if (bias === 'LONG') {
      const entry = price;
      const pullbackEntry = Math.min(le9, price - lATR * 0.3);
      const stopLoss = price - lATR * 1.2;
      const risk = entry - stopLoss;
      tradePlan = {
        direction: 'LONG', entry: { aggressive: entry, pullback: pullbackEntry }, stopLoss,
        targets: [entry + risk * 1.5, entry + risk * 2.5, entry + risk * 4],
        riskReward: '2.5', riskPercent: ((risk / entry) * 100).toFixed(2), atr: lATR
      };
    } else {
      const entry = price;
      const pullbackEntry = Math.max(le9, price + lATR * 0.3);
      const stopLoss = price + lATR * 1.2;
      const risk = stopLoss - entry;
      tradePlan = {
        direction: 'SHORT', entry: { aggressive: entry, pullback: pullbackEntry }, stopLoss,
        targets: [entry - risk * 1.5, entry - risk * 2.5, entry - risk * 4],
        riskReward: '2.5', riskPercent: ((risk / entry) * 100).toFixed(2), atr: lATR
      };
    }
  }
  
  return { 
    bias, confidence: Math.min(Math.abs(totalScore) * 1.5, 100).toFixed(0), 
    bullScore, bearScore, signals, breakdown, shouldTrade, noTradeReason, tradePlan, score: totalScore,
    divergence, structure: structure.structure, volume,
    indicators: { rsi: lRSI, stochK: lStochK, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, bbWidth: lBB.width * 100, price: latest.close } 
  };
};

// ============ BACKTESTING WITH CONFLUENCE ============
const runBacktest = (data, initialCapital = 10000) => {
  if (data.length < 100) return null;
  
  const trades = [];
  let position = null;
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  
  for (let i = 50; i < data.length - 1; i++) {
    const slice = data.slice(0, i + 1);
    const analysis = analyzeSignals(slice, 0, 0, 0, 'NEUTRAL');
    const currentCandle = data[i];
    const nextCandle = data[i + 1];
    
    // Exit logic
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'LONG') {
        if (nextCandle.low <= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop Loss'; }
        else if (nextCandle.high >= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (nextCandle.high >= position.tp1 && !position.tp1Hit) { position.tp1Hit = true; position.stopLoss = position.entry; }
        else if (analysis.bias === 'SHORT' && analysis.score <= -15) { exitPrice = nextCandle.open; exitReason = 'Signal Flip'; }
      } else {
        if (nextCandle.high >= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop Loss'; }
        else if (nextCandle.low <= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (nextCandle.low <= position.tp1 && !position.tp1Hit) { position.tp1Hit = true; position.stopLoss = position.entry; }
        else if (analysis.bias === 'LONG' && analysis.score >= 15) { exitPrice = nextCandle.open; exitReason = 'Signal Flip'; }
      }
      
      if (!exitPrice && i - position.entryIndex > 30) { exitPrice = nextCandle.close; exitReason = 'Time Exit'; }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' ? (exitPrice - position.entry) * position.size : (position.entry - exitPrice) * position.size;
        const riskAmount = Math.abs(position.entry - position.originalStop) * position.size;
        const rMultiple = pnl / riskAmount;
        capital += pnl;
        maxCapital = Math.max(maxCapital, capital);
        maxDrawdown = Math.max(maxDrawdown, ((maxCapital - capital) / maxCapital) * 100);
        trades.push({ direction: position.direction, entry: position.entry, exit: exitPrice, pnl, pnlPercent: rMultiple, reason: exitReason, duration: i - position.entryIndex });
        position = null;
      }
    }
    
    // Entry - require higher conviction + volume
    if (!position && analysis.shouldTrade && analysis.tradePlan && Math.abs(analysis.score) >= 12 && analysis.volume.relative > 0.8) {
      const plan = analysis.tradePlan;
      const riskPerTrade = capital * 0.01;
      const stopDistance = Math.abs(currentCandle.close - plan.stopLoss);
      const positionSize = riskPerTrade / stopDistance;
      
      position = {
        direction: plan.direction, entry: currentCandle.close, stopLoss: plan.stopLoss, originalStop: plan.stopLoss,
        tp1: plan.targets[0], tp2: plan.targets[1], tp1Hit: false, entryIndex: i, size: positionSize
      };
    }
  }
  
  if (position) {
    const lastPrice = data[data.length - 1].close;
    const pnl = position.direction === 'LONG' ? (lastPrice - position.entry) * position.size : (position.entry - lastPrice) * position.size;
    const riskAmount = Math.abs(position.entry - position.originalStop) * position.size;
    trades.push({ direction: position.direction, entry: position.entry, exit: lastPrice, pnl, pnlPercent: pnl / riskAmount, reason: 'End', duration: data.length - position.entryIndex });
    capital += pnl;
  }
  
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  
  return {
    totalTrades: trades.length, winningTrades: wins.length, losingTrades: losses.length,
    winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: wins.length > 0 ? (wins.reduce((a, t) => a + t.pnlPercent, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length > 0 ? (losses.reduce((a, t) => a + t.pnlPercent, 0) / losses.length).toFixed(2) : 0,
    totalPnL: ((capital - initialCapital) / initialCapital * 100).toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : trades.length > 0 ? '∞' : '0',
    expectancy: trades.length > 0 ? (trades.reduce((a, t) => a + t.pnlPercent, 0) / trades.length).toFixed(2) : 0,
    trades: trades.slice(-15)
  };
};

// ============ UI COMPONENTS ============
const Badge = ({ label, value, status }) => {
  const c = { bullish: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' }, bearish: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444' }, neutral: { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' } }[status] || { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' };
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '4px 6px' }}><span style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '11px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

const StatBox = ({ label, value, color = '#fff' }) => (
  <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px', textAlign: 'center' }}>
    <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px' }}>{label}</div>
    <div style={{ fontSize: '13px', fontWeight: '600', color }}>{value}</div>
  </div>
);

const SignalBox = ({ analysis, timeframe, small = false }) => (
  <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: small ? '8px' : '10px', textAlign: 'center' }}>
    <div style={{ fontSize: '8px', color: '#888', letterSpacing: '1px', marginBottom: '2px' }}>{timeframe}</div>
    <div style={{ fontSize: small ? '22px' : '26px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis.bias}</div>
    <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>Score: <span style={{ color: analysis.score > 0 ? '#10b981' : analysis.score < 0 ? '#ef4444' : '#666' }}>{analysis.score > 0 ? '+' : ''}{analysis.score}</span></div>
    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '4px', fontSize: '9px' }}>
      <span style={{ color: '#10b981' }}>▲{analysis.bullScore}</span>
      <span style={{ color: '#ef4444' }}>▼{analysis.bearScore}</span>
    </div>
  </div>
);

// ============ MAIN DASHBOARD ============
export default function Dashboard() {
  const [data5m, setData5m] = useState([]);
  const [data1m, setData1m] = useState([]);
  const [dataBtc, setDataBtc] = useState([]);
  const [price, setPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(0);
  const [update, setUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(0);
  const [oi, setOi] = useState(0);
  const [oiChange, setOiChange] = useState(0);
  const [prevOi, setPrevOi] = useState(0);
  const [backtest, setBacktest] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [backtestTf, setBacktestTf] = useState('5m');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [res5m, res1m, resBtc] = await Promise.all([
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=500'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=100')
        ]);
        
        const parse = (klines) => klines.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        
        const [klines5m, klines1m, klinesBtc] = await Promise.all([res5m.json(), res1m.json(), resBtc.json()]);
        setData5m(parse(klines5m));
        setData1m(parse(klines1m));
        setDataBtc(parse(klinesBtc));
        
        const parsed5m = parse(klines5m);
        setPrice(parsed5m[parsed5m.length - 1].close);
        setPriceChange(((parsed5m[parsed5m.length - 1].close - parsed5m[parsed5m.length - 2].close) / parsed5m[parsed5m.length - 2].close) * 100);
        
        try {
          const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=1');
          const fundingData = await fundingRes.json();
          if (fundingData[0]) setFunding(parseFloat(fundingData[0].fundingRate));
        } catch (e) {}
        
        try {
          const oiRes = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=SOLUSDT');
          const oiData = await oiRes.json();
          const newOi = parseFloat(oiData.openInterest);
          if (prevOi > 0) setOiChange(((newOi - prevOi) / prevOi) * 100);
          setPrevOi(newOi);
          setOi(newOi);
        } catch (e) {}
        
        setLoading(false);
        setUpdate(new Date());
      } catch (e) { setLoading(false); }
    };
    
    fetchData();
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_1m');
    ws.onmessage = (e) => { const k = JSON.parse(e.data).k; setPrice(parseFloat(k.c)); setUpdate(new Date()); };
    const interval = setInterval(fetchData, 15000);
    return () => { ws.close(); clearInterval(interval); };
  }, [prevOi]);

  // BTC analysis for correlation
  const btcAnalysis = useMemo(() => analyzeSignals(dataBtc, 0, 0, 0, 'NEUTRAL'), [dataBtc]);
  const analysis5m = useMemo(() => analyzeSignals(data5m, funding, oi, oiChange, btcAnalysis.bias), [data5m, funding, oi, oiChange, btcAnalysis.bias]);
  const analysis1m = useMemo(() => analyzeSignals(data1m, funding, oi, oiChange, btcAnalysis.bias), [data1m, funding, oi, oiChange, btcAnalysis.bias]);
  
  // MTF Confluence
  const mtfConfluence = useMemo(() => {
    if (analysis5m.bias === analysis1m.bias && analysis5m.bias !== 'NEUTRAL') {
      return { aligned: true, bias: analysis5m.bias, strength: 'STRONG' };
    } else if (analysis5m.bias !== 'NEUTRAL' && analysis1m.bias === 'NEUTRAL') {
      return { aligned: false, bias: analysis5m.bias, strength: 'MODERATE' };
    } else if (analysis5m.bias !== analysis1m.bias && analysis5m.bias !== 'NEUTRAL' && analysis1m.bias !== 'NEUTRAL') {
      return { aligned: false, bias: 'CONFLICT', strength: 'WEAK' };
    }
    return { aligned: false, bias: 'NEUTRAL', strength: 'NONE' };
  }, [analysis5m.bias, analysis1m.bias]);
  
  const handleRunBacktest = (tf) => {
    setBacktestTf(tf);
    const result = runBacktest(tf === '1m' ? data1m : data5m);
    setBacktest(result);
    setShowBacktest(true);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: '700' }}>SOL PERP</span>
          <span style={{ background: mtfConfluence.strength === 'STRONG' ? '#10b981' : mtfConfluence.strength === 'MODERATE' ? '#f59e0b' : '#666', color: '#000', padding: '2px 6px', fontSize: '8px', fontWeight: '600' }}>{mtfConfluence.strength}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: '600' }}>${price?.toFixed(2)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '10px' }}>{priceChange >= 0 ? '▲' : '▼'}{Math.abs(priceChange).toFixed(2)}%</span>
        </div>
      </div>
      
      {/* MTF Confluence Alert */}
      {mtfConfluence.aligned && (
        <div style={{ background: mtfConfluence.bias === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', border: `1px solid ${mtfConfluence.bias === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '8px', marginBottom: '8px', textAlign: 'center' }}>
          <span style={{ color: mtfConfluence.bias === 'LONG' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '12px' }}>⚡ MTF CONFLUENCE: {mtfConfluence.bias} — 1m & 5m aligned!</span>
        </div>
      )}
      
      {mtfConfluence.bias === 'CONFLICT' && (
        <div style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid #f59e0b', padding: '8px', marginBottom: '8px', textAlign: 'center' }}>
          <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '11px' }}>⚠️ TIMEFRAME CONFLICT — 1m and 5m disagree, wait for alignment</span>
        </div>
      )}
      
      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '4px' }}>
          <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
            <span>5M SOL</span>
            <span style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : analysis5m.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis5m.bias} ({analysis5m.score > 0 ? '+' : ''}{analysis5m.score})</span>
          </div>
          <Chart interval="5m" symbol="SOLUSDT" />
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '4px' }}>
          <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
            <span>1M SOL</span>
            <span style={{ color: analysis1m.bias === 'LONG' ? '#10b981' : analysis1m.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis1m.bias} ({analysis1m.score > 0 ? '+' : ''}{analysis1m.score})</span>
          </div>
          <Chart interval="1m" symbol="SOLUSDT" />
        </div>
      </div>
      
      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
            <StatBox label="FUNDING" value={`${(funding * 100).toFixed(3)}%`} color={funding > 0.0003 ? '#ef4444' : funding < -0.0003 ? '#10b981' : '#888'} />
            <StatBox label="OI" value={`${(oi / 1000000).toFixed(1)}M`} />
            <StatBox label="BTC" value={btcAnalysis.bias} color={btcAnalysis.bias === 'LONG' ? '#10b981' : btcAnalysis.bias === 'SHORT' ? '#ef4444' : '#666'} />
            <StatBox label="STRUCT" value={analysis5m.structure?.toUpperCase().slice(0,6) || 'N/A'} color={analysis5m.structure === 'uptrend' ? '#10b981' : analysis5m.structure === 'downtrend' ? '#ef4444' : '#888'} />
            <StatBox label="VOL" value={`${analysis5m.volume?.relative?.toFixed(1) || '1.0'}x`} color={analysis5m.volume?.relative > 1.5 ? '#10b981' : analysis5m.volume?.relative < 0.7 ? '#ef4444' : '#888'} />
            <StatBox label="ADX" value={analysis5m.indicators?.adx?.toFixed(0) || '--'} color={analysis5m.indicators?.adx > 25 ? '#10b981' : '#666'} />
          </div>
          
          {/* Signal Boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <SignalBox analysis={analysis5m} timeframe="5M" />
            <SignalBox analysis={analysis1m} timeframe="1M" />
            <SignalBox analysis={btcAnalysis} timeframe="BTC" small />
          </div>
          
          {/* Trade Plan */}
          {analysis5m.tradePlan && mtfConfluence.strength !== 'WEAK' && (
            <div style={{ background: analysis5m.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${analysis5m.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '8px' }}>
              <div style={{ fontSize: '8px', color: '#888', letterSpacing: '1px', marginBottom: '6px' }}>
                TRADE PLAN — {analysis5m.tradePlan.direction}
                {mtfConfluence.aligned && <span style={{ color: '#10b981', marginLeft: '8px' }}>✓ MTF CONFIRMED</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>ENTRY</div>
                  <div style={{ fontSize: '12px', color: '#fff' }}>${analysis5m.tradePlan.entry.aggressive.toFixed(3)}</div>
                  <div style={{ fontSize: '8px', color: '#666' }}>PB: ${analysis5m.tradePlan.entry.pullback.toFixed(3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>STOP</div>
                  <div style={{ fontSize: '12px', color: '#ef4444' }}>${analysis5m.tradePlan.stopLoss.toFixed(3)}</div>
                  <div style={{ fontSize: '8px', color: '#666' }}>Risk: {analysis5m.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '7px', color: '#666' }}>TARGETS</div>
                  <div style={{ fontSize: '9px', color: '#10b981' }}>TP1: ${analysis5m.tradePlan.targets[0].toFixed(2)}</div>
                  <div style={{ fontSize: '9px', color: '#10b981' }}>TP2: ${analysis5m.tradePlan.targets[1].toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
          
          {!analysis5m.shouldTrade && analysis5m.noTradeReason && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', padding: '8px' }}>
              <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '9px' }}>⚠ NO TRADE: </span>
              <span style={{ color: '#888', fontSize: '9px' }}>{analysis5m.noTradeReason}</span>
            </div>
          )}
          
          {/* Special Signals */}
          {(analysis5m.divergence?.bullish || analysis5m.divergence?.bearish) && (
            <div style={{ background: analysis5m.divergence.bullish ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${analysis5m.divergence.bullish ? '#10b981' : '#ef4444'}`, padding: '8px', textAlign: 'center' }}>
              <span style={{ color: analysis5m.divergence.bullish ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '11px' }}>
                🎯 {analysis5m.divergence.bullish ? 'BULLISH' : 'BEARISH'} DIVERGENCE DETECTED
              </span>
            </div>
          )}
          
          {/* Backtest */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => handleRunBacktest('5m')} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 12px', fontSize: '9px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 5M</button>
            <button onClick={() => handleRunBacktest('1m')} style={{ background: '#8b5cf6', color: '#fff', border: 'none', padding: '6px 12px', fontSize: '9px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 1M</button>
          </div>
          
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px' }}>BACKTEST {backtestTf.toUpperCase()}</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '12px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '8px' }}>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>WIN%</div><div style={{ fontSize: '12px', color: parseFloat(backtest.winRate) > 45 ? '#10b981' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>TRADES</div><div style={{ fontSize: '12px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>P&L</div><div style={{ fontSize: '12px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>DD</div><div style={{ fontSize: '12px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>PF</div><div style={{ fontSize: '12px', color: parseFloat(backtest.profitFactor) > 1 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginBottom: '6px' }}>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>AVG WIN</div><div style={{ fontSize: '11px', color: '#10b981' }}>{backtest.avgWin}R</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>AVG LOSS</div><div style={{ fontSize: '11px', color: '#ef4444' }}>{backtest.avgLoss}R</div></div>
                <div style={{ background: '#111', padding: '4px', textAlign: 'center' }}><div style={{ fontSize: '7px', color: '#666' }}>EXPECT</div><div style={{ fontSize: '11px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
              </div>
              <div style={{ maxHeight: '120px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 70px 50px', padding: '2px 0', borderBottom: '1px solid #1a1a1a', fontSize: '8px', alignItems: 'center' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(2)}→${t.exit.toFixed(2)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
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
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <Badge label="RSI" value={analysis5m.indicators?.rsi?.toFixed(0) || '--'} status={analysis5m.indicators?.rsi < 30 ? 'bullish' : analysis5m.indicators?.rsi > 70 ? 'bearish' : 'neutral'} />
              <Badge label="STOCH" value={analysis5m.indicators?.stochK?.toFixed(0) || '--'} status={analysis5m.indicators?.stochK < 20 ? 'bullish' : analysis5m.indicators?.stochK > 80 ? 'bearish' : 'neutral'} />
              <Badge label="MACD" value={analysis5m.indicators?.macd?.toFixed(3) || '--'} status={analysis5m.indicators?.macd > analysis5m.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="ATR" value={`$${analysis5m.indicators?.atr?.toFixed(2) || '--'}`} status="neutral" />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>BREAKDOWN</div>
            {Object.entries(analysis5m.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', marginBottom: '2px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span>
                </div>
                <div style={{ height: '2px', background: '#1a1a1a', borderRadius: '1px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: '7px', color: '#666', letterSpacing: '1px', marginBottom: '4px' }}>SIGNALS ({analysis5m.signals?.length || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {(analysis5m.signals || []).map((s, i) => (
                <div key={i} style={{ fontSize: '8px', padding: '2px 4px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#444' }}>
        <div>Live • MTF + BTC Correlation + Divergence + Volume • {update?.toLocaleTimeString()}</div>
        <div>NFA</div>
      </div>
    </div>
  );
}
