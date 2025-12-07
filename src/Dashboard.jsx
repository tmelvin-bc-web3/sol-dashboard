import React, { useState, useEffect, useMemo, useRef } from 'react';

// ============ CHART COMPONENT ============
const Chart = ({ interval = '5m' }) => {
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

      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=${interval}&limit=200`);
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

        const wsInterval = interval === '1m' ? '1m' : '5m';
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/solusdt@kline_${wsInterval}`);
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
  }, [interval]);

  return <div ref={containerRef} style={{ width: '100%', height: '300px' }} />;
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

const findSwings = (data, lookback = 5) => {
  const highs = [], lows = [];
  for (let i = lookback; i < data.length - lookback; i++) {
    const leftHighs = data.slice(i - lookback, i).map(d => d.high);
    const rightHighs = data.slice(i + 1, i + lookback + 1).map(d => d.high);
    if (data[i].high > Math.max(...leftHighs) && data[i].high > Math.max(...rightHighs)) highs.push(data[i].high);
    const leftLows = data.slice(i - lookback, i).map(d => d.low);
    const rightLows = data.slice(i + 1, i + lookback + 1).map(d => d.low);
    if (data[i].low < Math.min(...leftLows) && data[i].low < Math.min(...rightLows)) lows.push(data[i].low);
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) };
};

// ============ SIGNAL ANALYSIS (More Sensitive) ============
const analyzeSignals = (data, funding = 0, oi = 0, oiChange = 0) => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null, score: 0 };
  
  const latest = data[data.length - 1], prev = data[data.length - 2];
  const ema9 = calcEMA(data, 9), ema21 = calcEMA(data, 21), ema50 = calcEMA(data, 50);
  const rsi = calcRSI(data), stochRSI = calcStochRSI(data);
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data), bb = calcBB(data);
  const swings = findSwings(data);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { 
    trend: { score: 0, max: 30, signals: [] }, 
    momentum: { score: 0, max: 30, signals: [] }, 
    funding: { score: 0, max: 25, signals: [] },
    volatility: { score: 0, max: 15, signals: [] }
  };
  
  const le9 = ema9[ema9.length - 1], le21 = ema21[ema21.length - 1], le50 = ema50[ema50.length - 1];
  const pe9 = ema9[ema9.length - 2], pe21 = ema21[ema21.length - 2];
  
  // TREND - More aggressive scoring
  if (le9 > le21 && le21 > le50) { bullScore += 12; breakdown.trend.score += 12; breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs bullish ↑' }); }
  else if (le9 < le21 && le21 < le50) { bearScore += 12; breakdown.trend.score -= 12; breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs bearish ↓' }); }
  else if (le9 > le21) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: '9 > 21 EMA' }); }
  else if (le9 < le21) { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: '9 < 21 EMA' }); }
  
  if (latest.close > le9) { bullScore += 4; breakdown.trend.score += 4; breakdown.trend.signals.push({ type: 'bullish', text: 'Price > EMA9' }); }
  else { bearScore += 4; breakdown.trend.score -= 4; breakdown.trend.signals.push({ type: 'bearish', text: 'Price < EMA9' }); }
  
  if (pe9 <= pe21 && le9 > le21) { bullScore += 10; breakdown.trend.score += 10; breakdown.trend.signals.push({ type: 'bullish', text: '🔥 Golden cross!' }); }
  if (pe9 >= pe21 && le9 < le21) { bearScore += 10; breakdown.trend.score -= 10; breakdown.trend.signals.push({ type: 'bearish', text: '🔥 Death cross!' }); }
  
  const lADX = adx[adx.length - 1], lPlus = plusDI[plusDI.length - 1], lMinus = minusDI[minusDI.length - 1];
  if (lADX > 25) { 
    if (lPlus > lMinus) { bullScore += 6; breakdown.trend.score += 6; breakdown.trend.signals.push({ type: 'bullish', text: `ADX ${lADX.toFixed(0)} trending up` }); } 
    else { bearScore += 6; breakdown.trend.score -= 6; breakdown.trend.signals.push({ type: 'bearish', text: `ADX ${lADX.toFixed(0)} trending down` }); } 
  }
  
  // MOMENTUM - More sensitive
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
  
  if (lHist > 0 && lHist > pHist) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'Histogram rising' }); }
  else if (lHist < 0 && lHist < pHist) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'Histogram falling' }); }
  
  // FUNDING - More impact
  const fundingPct = funding * 100;
  if (fundingPct > 0.03) { bearScore += 10; breakdown.funding.score -= 10; breakdown.funding.signals.push({ type: 'bearish', text: `Funding ${fundingPct.toFixed(3)}% longs pay` }); }
  else if (fundingPct > 0.01) { bearScore += 5; breakdown.funding.score -= 5; breakdown.funding.signals.push({ type: 'bearish', text: `Funding ${fundingPct.toFixed(3)}% slightly long` }); }
  else if (fundingPct < -0.03) { bullScore += 10; breakdown.funding.score += 10; breakdown.funding.signals.push({ type: 'bullish', text: `Funding ${fundingPct.toFixed(3)}% shorts pay` }); }
  else if (fundingPct < -0.01) { bullScore += 5; breakdown.funding.score += 5; breakdown.funding.signals.push({ type: 'bullish', text: `Funding ${fundingPct.toFixed(3)}% slightly short` }); }
  else { breakdown.funding.signals.push({ type: 'neutral', text: `Funding neutral ${fundingPct.toFixed(3)}%` }); }
  
  if (oiChange > 5) { breakdown.funding.signals.push({ type: 'neutral', text: `OI +${oiChange.toFixed(1)}% new positions` }); }
  else if (oiChange < -5) { breakdown.funding.signals.push({ type: 'neutral', text: `OI ${oiChange.toFixed(1)}% closing` }); }
  
  // VOLATILITY
  const lBB = bb[bb.length - 1], lATR = atr[atr.length - 1];
  if (lBB.width < 0.02) { breakdown.volatility.signals.push({ type: 'neutral', text: 'BB squeeze ⚡' }); }
  if (latest.close <= lBB.lower) { bullScore += 8; breakdown.volatility.score += 8; breakdown.volatility.signals.push({ type: 'bullish', text: 'At lower BB' }); }
  else if (latest.close >= lBB.upper) { bearScore += 8; breakdown.volatility.score -= 8; breakdown.volatility.signals.push({ type: 'bearish', text: 'At upper BB' }); }
  else if (latest.close < lBB.middle) { bearScore += 2; breakdown.volatility.score -= 2; breakdown.volatility.signals.push({ type: 'bearish', text: 'Below BB mid' }); }
  else { bullScore += 2; breakdown.volatility.score += 2; breakdown.volatility.signals.push({ type: 'bullish', text: 'Above BB mid' }); }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  
  // LOWER THRESHOLD - was 15, now 8
  let bias = 'NEUTRAL'; 
  if (totalScore >= 8) bias = 'LONG'; 
  else if (totalScore <= -8) bias = 'SHORT';
  
  let shouldTrade = true;
  let noTradeReason = '';
  if (lADX < 15 && Math.abs(totalScore) < 15) { shouldTrade = false; noTradeReason = 'No trend + low conviction'; }
  if (lBB.width < 0.015) { shouldTrade = false; noTradeReason = 'BB squeeze - wait for breakout'; }
  
  // TRADE PLAN
  let tradePlan = null;
  if (bias !== 'NEUTRAL') {
    const price = latest.close;
    const atrVal = lATR;
    
    if (bias === 'LONG') {
      const entry = price;
      const pullbackEntry = Math.min(le9, price - atrVal * 0.3);
      const stopLoss = price - atrVal * 1.2;
      const risk = entry - stopLoss;
      tradePlan = {
        direction: 'LONG',
        entry: { aggressive: entry, pullback: pullbackEntry },
        stopLoss,
        targets: [entry + risk * 1.5, entry + risk * 2.5, entry + risk * 4],
        riskReward: '2.5',
        riskPercent: ((risk / entry) * 100).toFixed(2),
        atr: atrVal
      };
    } else {
      const entry = price;
      const pullbackEntry = Math.max(le9, price + atrVal * 0.3);
      const stopLoss = price + atrVal * 1.2;
      const risk = stopLoss - entry;
      tradePlan = {
        direction: 'SHORT',
        entry: { aggressive: entry, pullback: pullbackEntry },
        stopLoss,
        targets: [entry - risk * 1.5, entry - risk * 2.5, entry - risk * 4],
        riskReward: '2.5',
        riskPercent: ((risk / entry) * 100).toFixed(2),
        atr: atrVal
      };
    }
  }
  
  return { 
    bias, 
    confidence: Math.min(Math.abs(totalScore) * 2, 100).toFixed(0), 
    bullScore, 
    bearScore, 
    signals, 
    breakdown, 
    shouldTrade,
    noTradeReason,
    tradePlan,
    score: totalScore,
    indicators: { rsi: lRSI, stochK: lStochK, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, bbWidth: lBB.width * 100, price: latest.close } 
  };
};

// ============ FIXED BACKTESTING ============
const runBacktest = (data, initialCapital = 10000) => {
  if (data.length < 100) return null;
  
  const trades = [];
  let position = null;
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  
  for (let i = 50; i < data.length - 1; i++) {
    const slice = data.slice(0, i + 1);
    const analysis = analyzeSignals(slice, 0, 0, 0);
    const currentCandle = data[i];
    const nextCandle = data[i + 1];
    
    // Exit logic FIRST (before new entries)
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'LONG') {
        // Check stop loss first (priority)
        if (nextCandle.low <= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = 'Stop Loss'; 
        }
        // Then check take profits
        else if (nextCandle.high >= position.tp2) { 
          exitPrice = position.tp2; 
          exitReason = 'TP2'; 
        }
        else if (nextCandle.high >= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true;
          // Move stop to breakeven after TP1
          position.stopLoss = position.entry;
        }
        // Signal flip exit
        else if (analysis.bias === 'SHORT' && analysis.score <= -12) {
          exitPrice = nextCandle.open;
          exitReason = 'Signal Flip';
        }
      } else { // SHORT
        if (nextCandle.high >= position.stopLoss) { 
          exitPrice = position.stopLoss; 
          exitReason = 'Stop Loss'; 
        }
        else if (nextCandle.low <= position.tp2) { 
          exitPrice = position.tp2; 
          exitReason = 'TP2'; 
        }
        else if (nextCandle.low <= position.tp1 && !position.tp1Hit) { 
          position.tp1Hit = true;
          position.stopLoss = position.entry;
        }
        else if (analysis.bias === 'LONG' && analysis.score >= 12) {
          exitPrice = nextCandle.open;
          exitReason = 'Signal Flip';
        }
      }
      
      // Time-based exit (max 30 candles)
      if (!exitPrice && i - position.entryIndex > 30) {
        exitPrice = nextCandle.close;
        exitReason = 'Time Exit';
      }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' 
          ? (exitPrice - position.entry) * position.size 
          : (position.entry - exitPrice) * position.size;
        
        const riskAmount = Math.abs(position.entry - position.originalStop) * position.size;
        const rMultiple = pnl / riskAmount;
        
        capital += pnl;
        maxCapital = Math.max(maxCapital, capital);
        const drawdown = ((maxCapital - capital) / maxCapital) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
        
        trades.push({
          direction: position.direction,
          entry: position.entry,
          exit: exitPrice,
          pnl,
          pnlPercent: rMultiple,
          reason: exitReason,
          duration: i - position.entryIndex
        });
        
        position = null;
      }
    }
    
    // Entry logic (only if no position)
    if (!position && analysis.shouldTrade && analysis.tradePlan && Math.abs(analysis.score) >= 10) {
      const plan = analysis.tradePlan;
      const riskPerTrade = capital * 0.01; // 1% risk
      const stopDistance = Math.abs(currentCandle.close - plan.stopLoss);
      const positionSize = riskPerTrade / stopDistance;
      
      position = {
        direction: plan.direction,
        entry: currentCandle.close,
        stopLoss: plan.stopLoss,
        originalStop: plan.stopLoss,
        tp1: plan.targets[0],
        tp2: plan.targets[1],
        tp1Hit: false,
        entryIndex: i,
        size: positionSize
      };
    }
  }
  
  // Close any open position at end
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
      duration: data.length - position.entryIndex
    });
    capital += pnl;
  }
  
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const totalWins = winningTrades.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((a, t) => a + t.pnl, 0));
  
  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? ((winningTrades.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: winningTrades.length > 0 ? (winningTrades.reduce((a, t) => a + t.pnlPercent, 0) / winningTrades.length).toFixed(2) : 0,
    avgLoss: losingTrades.length > 0 ? (losingTrades.reduce((a, t) => a + t.pnlPercent, 0) / losingTrades.length).toFixed(2) : 0,
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
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '5px 8px' }}><span style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '12px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

const StatBox = ({ label, value, color = '#fff', small = false }) => (
  <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: small ? '8px' : '10px', textAlign: 'center' }}>
    <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '2px' }}>{label}</div>
    <div style={{ fontSize: small ? '14px' : '16px', fontWeight: '600', color }}>{value}</div>
  </div>
);

const SignalBox = ({ analysis, timeframe }) => (
  <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '12px', textAlign: 'center' }}>
    <div style={{ fontSize: '9px', color: '#888', letterSpacing: '1px', marginBottom: '4px' }}>{timeframe} BIAS</div>
    <div style={{ fontSize: '28px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis.bias}</div>
    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>Score: <span style={{ color: analysis.score > 0 ? '#10b981' : analysis.score < 0 ? '#ef4444' : '#666' }}>{analysis.score > 0 ? '+' : ''}{analysis.score}</span></div>
    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '6px', fontSize: '10px' }}>
      <span style={{ color: '#10b981' }}>▲{analysis.bullScore}</span>
      <span style={{ color: '#ef4444' }}>▼{analysis.bearScore}</span>
    </div>
  </div>
);

// ============ MAIN DASHBOARD ============
export default function Dashboard() {
  const [data5m, setData5m] = useState([]);
  const [data1m, setData1m] = useState([]);
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
        // 5m data
        const res5m = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=500');
        const klines5m = await res5m.json();
        const parsed5m = klines5m.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        setData5m(parsed5m);
        
        // 1m data
        const res1m = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=500');
        const klines1m = await res1m.json();
        const parsed1m = klines1m.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        setData1m(parsed1m);
        
        setPrice(parsed5m[parsed5m.length - 1].close);
        setPriceChange(((parsed5m[parsed5m.length - 1].close - parsed5m[parsed5m.length - 2].close) / parsed5m[parsed5m.length - 2].close) * 100);
        
        // Funding
        try {
          const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=1');
          const fundingData = await fundingRes.json();
          if (fundingData[0]) setFunding(parseFloat(fundingData[0].fundingRate));
        } catch (e) {}
        
        // OI
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

  const analysis5m = useMemo(() => analyzeSignals(data5m, funding, oi, oiChange), [data5m, funding, oi, oiChange]);
  const analysis1m = useMemo(() => analyzeSignals(data1m, funding, oi, oiChange), [data1m, funding, oi, oiChange]);
  
  const handleRunBacktest = (tf) => {
    setBacktestTf(tf);
    const data = tf === '1m' ? data1m : data5m;
    const result = runBacktest(data);
    setBacktest(result);
    setShowBacktest(true);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING...</div></div>;

  const activeAnalysis = analysis5m; // Use 5m for trade plan

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '10px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px', fontWeight: '700' }}>SOL PERP</span>
          <span style={{ background: '#3b82f6', color: '#000', padding: '2px 6px', fontSize: '9px', fontWeight: '600' }}>LIVE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '20px', fontWeight: '600' }}>${price?.toFixed(2)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '11px' }}>{priceChange >= 0 ? '▲' : '▼'}{Math.abs(priceChange).toFixed(2)}%</span>
        </div>
      </div>
      
      {/* Dual Timeframe Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
          <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
            <span>5 MINUTE</span>
            <span style={{ color: analysis5m.bias === 'LONG' ? '#10b981' : analysis5m.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis5m.bias}</span>
          </div>
          <Chart interval="5m" />
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '6px' }}>
          <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
            <span>1 MINUTE</span>
            <span style={{ color: analysis1m.bias === 'LONG' ? '#10b981' : analysis1m.bias === 'SHORT' ? '#ef4444' : '#666' }}>{analysis1m.bias}</span>
          </div>
          <Chart interval="1m" />
        </div>
      </div>
      
      {/* Main Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Funding & Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            <StatBox label="FUNDING" value={`${(funding * 100).toFixed(4)}%`} color={funding > 0.0003 ? '#ef4444' : funding < -0.0003 ? '#10b981' : '#888'} small />
            <StatBox label="OPEN INT" value={`${(oi / 1000000).toFixed(1)}M`} small />
            <StatBox label="OI Δ" value={`${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(1)}%`} color={oiChange > 3 ? '#10b981' : oiChange < -3 ? '#ef4444' : '#888'} small />
            <StatBox label="ADX" value={analysis5m.indicators?.adx?.toFixed(0) || '--'} color={analysis5m.indicators?.adx > 25 ? '#10b981' : '#666'} small />
          </div>
          
          {/* Dual Signal Boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <SignalBox analysis={analysis5m} timeframe="5M" />
            <SignalBox analysis={analysis1m} timeframe="1M" />
          </div>
          
          {/* Trade Plan */}
          {activeAnalysis.tradePlan && (
            <div style={{ background: activeAnalysis.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${activeAnalysis.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '10px' }}>
              <div style={{ fontSize: '9px', color: '#888', letterSpacing: '1px', marginBottom: '8px' }}>TRADE PLAN — {activeAnalysis.tradePlan.direction}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px' }}>ENTRY</div>
                  <div style={{ fontSize: '13px', color: '#fff' }}>${activeAnalysis.tradePlan.entry.aggressive.toFixed(3)}</div>
                  <div style={{ fontSize: '9px', color: '#666' }}>PB: ${activeAnalysis.tradePlan.entry.pullback.toFixed(3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px' }}>STOP</div>
                  <div style={{ fontSize: '13px', color: '#ef4444' }}>${activeAnalysis.tradePlan.stopLoss.toFixed(3)}</div>
                  <div style={{ fontSize: '9px', color: '#666' }}>Risk: {activeAnalysis.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px' }}>TARGETS</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>1: ${activeAnalysis.tradePlan.targets[0].toFixed(2)}</div>
                  <div style={{ fontSize: '10px', color: '#10b981' }}>2: ${activeAnalysis.tradePlan.targets[1].toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
          
          {!activeAnalysis.shouldTrade && activeAnalysis.noTradeReason && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', padding: '10px' }}>
              <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '10px' }}>⚠ NO TRADE: </span>
              <span style={{ color: '#888', fontSize: '10px' }}>{activeAnalysis.noTradeReason}</span>
            </div>
          )}
          
          {/* Backtest Controls */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => handleRunBacktest('5m')} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 5M</button>
            <button onClick={() => handleRunBacktest('1m')} style={{ background: '#8b5cf6', color: '#fff', border: 'none', padding: '8px 16px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>BACKTEST 1M</button>
          </div>
          
          {/* Backtest Results */}
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px' }}>BACKTEST {backtestTf.toUpperCase()} — 500 CANDLES</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginBottom: '10px' }}>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>WIN RATE</div><div style={{ fontSize: '14px', color: parseFloat(backtest.winRate) > 50 ? '#10b981' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>TRADES</div><div style={{ fontSize: '14px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>P&L</div><div style={{ fontSize: '14px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>MAX DD</div><div style={{ fontSize: '14px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>PROFIT F</div><div style={{ fontSize: '14px', color: parseFloat(backtest.profitFactor) > 1 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '10px' }}>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>AVG WIN</div><div style={{ fontSize: '12px', color: '#10b981' }}>{backtest.avgWin}R</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>AVG LOSS</div><div style={{ fontSize: '12px', color: '#ef4444' }}>{backtest.avgLoss}R</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>EXPECT</div><div style={{ fontSize: '12px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
                <div style={{ background: '#111', padding: '6px', textAlign: 'center' }}><div style={{ fontSize: '8px', color: '#666' }}>W/L</div><div style={{ fontSize: '12px', color: '#fff' }}>{backtest.winningTrades}/{backtest.losingTrades}</div></div>
              </div>
              <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>RECENT TRADES</div>
              <div style={{ maxHeight: '150px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 80px 60px', padding: '3px 0', borderBottom: '1px solid #1a1a1a', fontSize: '9px', alignItems: 'center' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
                    <span style={{ color: t.pnl > 0 ? '#10b981' : '#ef4444', textAlign: 'right' }}>{t.pnlPercent > 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}R</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right Column - Signals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '8px' }}>INDICATORS (5M)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              <Badge label="RSI" value={analysis5m.indicators?.rsi?.toFixed(1) || '--'} status={analysis5m.indicators?.rsi < 30 ? 'bullish' : analysis5m.indicators?.rsi > 70 ? 'bearish' : 'neutral'} />
              <Badge label="STOCH" value={analysis5m.indicators?.stochK?.toFixed(1) || '--'} status={analysis5m.indicators?.stochK < 20 ? 'bullish' : analysis5m.indicators?.stochK > 80 ? 'bearish' : 'neutral'} />
              <Badge label="MACD" value={analysis5m.indicators?.macd?.toFixed(4) || '--'} status={analysis5m.indicators?.macd > analysis5m.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="ATR" value={`$${analysis5m.indicators?.atr?.toFixed(2) || '--'}`} status="neutral" />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '8px' }}>BREAKDOWN (5M)</div>
            {Object.entries(analysis5m.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginBottom: '2px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span>
                </div>
                <div style={{ height: '3px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px', marginBottom: '6px' }}>SIGNALS ({analysis5m.signals?.length || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {(analysis5m.signals || []).map((s, i) => (
                <div key={i} style={{ fontSize: '9px', padding: '3px 5px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#444' }}>
        <div>Binance Live • Dual TF • {update?.toLocaleTimeString()}</div>
        <div>NFA DYOR</div>
      </div>
    </div>
  );
}
