import React, { useState, useEffect, useMemo, useRef } from 'react';

// ============ CHART COMPONENT ============
const Chart = () => {
  const containerRef = useRef(null);

  useEffect(() => {
    let chart, ws;
    const init = async () => {
      const { createChart } = await import('https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.mjs');
      if (!containerRef.current) return;

      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 400,
        layout: { background: { color: '#0a0a0a' }, textColor: '#666' },
        grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: '#1a1a1a' },
        timeScale: { borderColor: '#1a1a1a', timeVisible: true },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444',
        borderDownColor: '#ef4444', borderUpColor: '#10b981',
        wickDownColor: '#ef4444', wickUpColor: '#10b981',
      });

      const ema9 = chart.addLineSeries({ color: '#10b981', lineWidth: 1 });
      const ema21 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });

      try {
        const res = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=200');
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

        ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_5m');
        ws.onmessage = (e) => {
          const k = JSON.parse(e.data).k;
          candleSeries.update({ time: k.t / 1000, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) });
        };
      } catch (err) { console.error(err); }

      const resize = () => chart?.applyOptions({ width: containerRef.current?.clientWidth });
      window.addEventListener('resize', resize);
      return () => { window.removeEventListener('resize', resize); ws?.close(); chart?.remove(); };
    };
    init();
    return () => { ws?.close(); chart?.remove(); };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '400px' }} />;
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
  if (i < period - 1) return { upper: data[i].close, lower: data[i].close, width: 0 };
  const slice = data.slice(i - period + 1, i + 1), sma = slice.reduce((a, b) => a + b.close, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b.close - sma, 2), 0) / period);
  return { upper: sma + mult * std, lower: sma - mult * std, width: (mult * std * 2) / sma };
});

// Find swing highs/lows for S/R
const findSwings = (data, lookback = 10) => {
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

// ============ SIGNAL ANALYSIS ============
const analyzeSignals = (data, funding = 0, oi = 0, oiChange = 0) => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {}, tradePlan: null };
  
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
    trend: { score: 0, max: 25, signals: [] }, 
    momentum: { score: 0, max: 25, signals: [] }, 
    funding: { score: 0, max: 20, signals: [] },
    volatility: { score: 0, max: 15, signals: [] }, 
    priceAction: { score: 0, max: 15, signals: [] } 
  };
  
  // EMAs
  const le9 = ema9[ema9.length - 1], le21 = ema21[ema21.length - 1], le50 = ema50[ema50.length - 1];
  const pe9 = ema9[ema9.length - 2], pe21 = ema21[ema21.length - 2];
  
  if (le9 > le21 && le21 > le50) { bullScore += 8; breakdown.trend.score += 8; breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs bullish stack' }); }
  else if (le9 < le21 && le21 < le50) { bearScore += 8; breakdown.trend.score -= 8; breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs bearish stack' }); }
  
  if (latest.close > le9 && latest.close > le21) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: 'Price > EMAs' }); }
  else if (latest.close < le9 && latest.close < le21) { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: 'Price < EMAs' }); }
  
  if (pe9 <= pe21 && le9 > le21) { bullScore += 7; breakdown.trend.score += 7; breakdown.trend.signals.push({ type: 'bullish', text: 'Golden cross' }); }
  if (pe9 >= pe21 && le9 < le21) { bearScore += 7; breakdown.trend.score -= 7; breakdown.trend.signals.push({ type: 'bearish', text: 'Death cross' }); }
  
  // ADX
  const lADX = adx[adx.length - 1], lPlus = plusDI[plusDI.length - 1], lMinus = minusDI[minusDI.length - 1];
  if (lADX > 25) { 
    if (lPlus > lMinus) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: `ADX ${lADX.toFixed(0)} (+DI lead)` }); } 
    else { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: `ADX ${lADX.toFixed(0)} (-DI lead)` }); } 
  } else {
    breakdown.trend.signals.push({ type: 'neutral', text: `Weak trend (ADX ${lADX.toFixed(0)})` });
  }
  
  // RSI & Stoch
  const lRSI = rsi[rsi.length - 1], lStochK = stochRSI.k[stochRSI.k.length - 1];
  const lMACD = macd[macd.length - 1], lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1], pHist = histogram[histogram.length - 2];
  
  if (lRSI < 30) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold (${lRSI.toFixed(0)})` }); }
  else if (lRSI > 70) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought (${lRSI.toFixed(0)})` }); }
  else if (lRSI > 50) { bullScore += 2; breakdown.momentum.score += 2; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI ${lRSI.toFixed(0)}` }); }
  else { bearScore += 2; breakdown.momentum.score -= 2; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI ${lRSI.toFixed(0)}` }); }
  
  if (lStochK < 20) { bullScore += 5; breakdown.momentum.score += 5; breakdown.momentum.signals.push({ type: 'bullish', text: 'Stoch oversold' }); }
  else if (lStochK > 80) { bearScore += 5; breakdown.momentum.score -= 5; breakdown.momentum.signals.push({ type: 'bearish', text: 'Stoch overbought' }); }
  
  // MACD
  const pMACD = macd[macd.length - 2], pSig = macdSig[macdSig.length - 2];
  if (pMACD <= pSig && lMACD > lSig) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD cross up' }); }
  if (pMACD >= pSig && lMACD < lSig) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD cross down' }); }
  if (lHist > 0 && lHist > pHist) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD momentum ↑' }); }
  else if (lHist < 0 && lHist < pHist) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD momentum ↓' }); }
  
  // FUNDING RATE & OI ANALYSIS
  const fundingPct = funding * 100;
  if (Math.abs(fundingPct) > 0.05) {
    if (fundingPct > 0.05) {
      bearScore += 8; breakdown.funding.score -= 8;
      breakdown.funding.signals.push({ type: 'bearish', text: `High funding ${fundingPct.toFixed(3)}% (longs pay)` });
      if (oiChange > 5) {
        bearScore += 6; breakdown.funding.score -= 6;
        breakdown.funding.signals.push({ type: 'bearish', text: `Rising OI + high funding = squeeze risk` });
      }
    } else if (fundingPct < -0.05) {
      bullScore += 8; breakdown.funding.score += 8;
      breakdown.funding.signals.push({ type: 'bullish', text: `Negative funding ${fundingPct.toFixed(3)}% (shorts pay)` });
      if (oiChange > 5) {
        bullScore += 6; breakdown.funding.score += 6;
        breakdown.funding.signals.push({ type: 'bullish', text: `Rising OI + neg funding = squeeze risk` });
      }
    }
  } else {
    breakdown.funding.signals.push({ type: 'neutral', text: `Neutral funding ${fundingPct.toFixed(3)}%` });
  }
  
  if (oiChange > 10) {
    breakdown.funding.signals.push({ type: 'neutral', text: `OI up ${oiChange.toFixed(1)}% (new positions)` });
  } else if (oiChange < -10) {
    breakdown.funding.signals.push({ type: 'neutral', text: `OI down ${oiChange.toFixed(1)}% (closing positions)` });
  }
  
  // Bollinger
  const lBB = bb[bb.length - 1], lATR = atr[atr.length - 1];
  if (lBB.width < 0.025) { breakdown.volatility.signals.push({ type: 'neutral', text: 'BB squeeze (breakout soon)' }); }
  if (latest.close <= lBB.lower) { bullScore += 5; breakdown.volatility.score += 5; breakdown.volatility.signals.push({ type: 'bullish', text: 'At lower BB' }); }
  else if (latest.close >= lBB.upper) { bearScore += 5; breakdown.volatility.score -= 5; breakdown.volatility.signals.push({ type: 'bearish', text: 'At upper BB' }); }
  
  // Candle patterns
  const body = Math.abs(latest.close - latest.open), uWick = latest.high - Math.max(latest.close, latest.open), lWick = Math.min(latest.close, latest.open) - latest.low;
  if (lWick > body * 2 && uWick < body * 0.5 && latest.close > latest.open) { bullScore += 5; breakdown.priceAction.score += 5; breakdown.priceAction.signals.push({ type: 'bullish', text: 'Hammer' }); }
  if (uWick > body * 2 && lWick < body * 0.5 && latest.close < latest.open) { bearScore += 5; breakdown.priceAction.score -= 5; breakdown.priceAction.signals.push({ type: 'bearish', text: 'Shooting star' }); }
  
  // Compile signals
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  let bias = 'NEUTRAL'; 
  if (totalScore > 15) bias = 'LONG'; 
  else if (totalScore < -15) bias = 'SHORT';
  
  // Don't trade filter
  let shouldTrade = true;
  let noTradeReason = '';
  if (lADX < 20 && Math.abs(totalScore) < 25) { shouldTrade = false; noTradeReason = 'Weak trend + low conviction'; }
  if (lBB.width < 0.02) { shouldTrade = false; noTradeReason = 'BB squeeze - wait for breakout'; }
  
  // ============ TRADE PLAN ============
  let tradePlan = null;
  if (bias !== 'NEUTRAL' && shouldTrade) {
    const price = latest.close;
    const atrVal = lATR;
    
    if (bias === 'LONG') {
      const entry = price; // or le9 for pullback entry
      const pullbackEntry = le9;
      const stopLoss = Math.min(latest.low - atrVal * 1.5, swings.lows.length > 0 ? Math.min(...swings.lows) - atrVal * 0.5 : latest.low - atrVal * 2);
      const risk = entry - stopLoss;
      const tp1 = entry + risk * 1.5;
      const tp2 = entry + risk * 2.5;
      const tp3 = swings.highs.length > 0 ? Math.max(...swings.highs) : entry + risk * 3;
      
      tradePlan = {
        direction: 'LONG',
        entry: { aggressive: entry, pullback: pullbackEntry },
        stopLoss,
        targets: [tp1, tp2, tp3],
        riskReward: ((tp2 - entry) / risk).toFixed(1),
        riskPercent: ((risk / entry) * 100).toFixed(2),
        atr: atrVal
      };
    } else {
      const entry = price;
      const pullbackEntry = le9;
      const stopLoss = Math.max(latest.high + atrVal * 1.5, swings.highs.length > 0 ? Math.max(...swings.highs) + atrVal * 0.5 : latest.high + atrVal * 2);
      const risk = stopLoss - entry;
      const tp1 = entry - risk * 1.5;
      const tp2 = entry - risk * 2.5;
      const tp3 = swings.lows.length > 0 ? Math.min(...swings.lows) : entry - risk * 3;
      
      tradePlan = {
        direction: 'SHORT',
        entry: { aggressive: entry, pullback: pullbackEntry },
        stopLoss,
        targets: [tp1, tp2, tp3],
        riskReward: ((entry - tp2) / risk).toFixed(1),
        riskPercent: ((risk / entry) * 100).toFixed(2),
        atr: atrVal
      };
    }
  }
  
  return { 
    bias, 
    confidence: Math.min(Math.abs(totalScore), 100).toFixed(0), 
    bullScore, 
    bearScore, 
    signals, 
    breakdown, 
    shouldTrade,
    noTradeReason,
    tradePlan,
    indicators: { rsi: lRSI, stochK: lStochK, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, bbWidth: lBB.width * 100, price: latest.close } 
  };
};

// ============ BACKTESTING ============
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
    const nextCandle = data[i + 1];
    
    // Entry logic
    if (!position && analysis.shouldTrade && analysis.tradePlan) {
      const plan = analysis.tradePlan;
      position = {
        direction: plan.direction,
        entry: slice[slice.length - 1].close,
        stopLoss: plan.stopLoss,
        tp1: plan.targets[0],
        tp2: plan.targets[1],
        entryIndex: i,
        size: capital * 0.02 / Math.abs(slice[slice.length - 1].close - plan.stopLoss) // 2% risk per trade
      };
    }
    
    // Exit logic
    if (position) {
      const price = nextCandle.close;
      const high = nextCandle.high;
      const low = nextCandle.low;
      
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'LONG') {
        if (low <= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop Loss'; }
        else if (high >= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (high >= position.tp1) { exitPrice = position.tp1; exitReason = 'TP1'; }
      } else {
        if (high >= position.stopLoss) { exitPrice = position.stopLoss; exitReason = 'Stop Loss'; }
        else if (low <= position.tp2) { exitPrice = position.tp2; exitReason = 'TP2'; }
        else if (low <= position.tp1) { exitPrice = position.tp1; exitReason = 'TP1'; }
      }
      
      // Time-based exit (max 20 candles)
      if (!exitPrice && i - position.entryIndex > 20) {
        exitPrice = price;
        exitReason = 'Time Exit';
      }
      
      if (exitPrice) {
        const pnl = position.direction === 'LONG' 
          ? (exitPrice - position.entry) * position.size 
          : (position.entry - exitPrice) * position.size;
        
        capital += pnl;
        maxCapital = Math.max(maxCapital, capital);
        const drawdown = ((maxCapital - capital) / maxCapital) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
        
        trades.push({
          direction: position.direction,
          entry: position.entry,
          exit: exitPrice,
          pnl,
          pnlPercent: (pnl / (initialCapital * 0.02)) * 2, // As multiple of risk
          reason: exitReason,
          duration: i - position.entryIndex
        });
        
        position = null;
      }
    }
  }
  
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  
  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? ((winningTrades.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: winningTrades.length > 0 ? (winningTrades.reduce((a, t) => a + t.pnlPercent, 0) / winningTrades.length).toFixed(2) : 0,
    avgLoss: losingTrades.length > 0 ? (losingTrades.reduce((a, t) => a + t.pnlPercent, 0) / losingTrades.length).toFixed(2) : 0,
    totalPnL: ((capital - initialCapital) / initialCapital * 100).toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    profitFactor: losingTrades.length > 0 ? (winningTrades.reduce((a, t) => a + t.pnl, 0) / Math.abs(losingTrades.reduce((a, t) => a + t.pnl, 0))).toFixed(2) : '∞',
    expectancy: trades.length > 0 ? (trades.reduce((a, t) => a + t.pnlPercent, 0) / trades.length).toFixed(2) : 0,
    trades: trades.slice(-10) // Last 10 trades
  };
};

// ============ UI COMPONENTS ============
const Badge = ({ label, value, status }) => {
  const c = { bullish: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' }, bearish: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444' }, neutral: { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' } }[status] || { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' };
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '6px 10px' }}><span style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '13px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

const StatBox = ({ label, value, subtext, color = '#fff' }) => (
  <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px', textAlign: 'center' }}>
    <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: '20px', fontWeight: '600', color }}>{value}</div>
    {subtext && <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>{subtext}</div>}
  </div>
);

// ============ MAIN DASHBOARD ============
export default function Dashboard() {
  const [data, setData] = useState([]);
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
  const [backtestData, setBacktestData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Price data
        const res = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=500');
        const klines = await res.json();
        const parsed = klines.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        setData(parsed);
        setBacktestData(parsed);
        setPrice(parsed[parsed.length - 1].close);
        setPriceChange(((parsed[parsed.length - 1].close - parsed[parsed.length - 2].close) / parsed[parsed.length - 2].close) * 100);
        
        // Funding rate
        try {
          const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=1');
          const fundingData = await fundingRes.json();
          if (fundingData[0]) setFunding(parseFloat(fundingData[0].fundingRate));
        } catch (e) { console.log('Funding fetch failed'); }
        
        // Open Interest
        try {
          const oiRes = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=SOLUSDT');
          const oiData = await oiRes.json();
          const newOi = parseFloat(oiData.openInterest);
          if (prevOi > 0) setOiChange(((newOi - prevOi) / prevOi) * 100);
          setPrevOi(newOi);
          setOi(newOi);
        } catch (e) { console.log('OI fetch failed'); }
        
        setLoading(false);
        setUpdate(new Date());
      } catch (e) { setLoading(false); }
    };
    
    fetchData();
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_5m');
    ws.onmessage = (e) => { const k = JSON.parse(e.data).k; setPrice(parseFloat(k.c)); setUpdate(new Date()); };
    const interval = setInterval(fetchData, 30000);
    return () => { ws.close(); clearInterval(interval); };
  }, [prevOi]);

  const analysis = useMemo(() => analyzeSignals(data, funding, oi, oiChange), [data, funding, oi, oiChange]);
  
  const handleRunBacktest = () => {
    const result = runBacktest(backtestData);
    setBacktest(result);
    setShowBacktest(true);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px', fontWeight: '700' }}>SOL/USDT</span>
          <span style={{ background: '#10b981', color: '#000', padding: '2px 6px', fontSize: '9px', fontWeight: '600' }}>5M</span>
          <span style={{ background: '#3b82f6', color: '#000', padding: '2px 6px', fontSize: '9px', fontWeight: '600' }}>LIVE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontSize: '22px', fontWeight: '600' }}>${price?.toFixed(2)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '12px' }}>{priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%</span>
        </div>
      </div>
      
      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '12px' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Chart */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}><Chart /></div>
          
          {/* Funding & OI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            <StatBox label="FUNDING RATE" value={`${(funding * 100).toFixed(4)}%`} color={funding > 0.0005 ? '#ef4444' : funding < -0.0005 ? '#10b981' : '#888'} subtext={funding > 0 ? 'Longs pay' : 'Shorts pay'} />
            <StatBox label="OPEN INTEREST" value={`${(oi / 1000000).toFixed(1)}M`} color="#fff" />
            <StatBox label="OI CHANGE" value={`${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(1)}%`} color={oiChange > 5 ? '#10b981' : oiChange < -5 ? '#ef4444' : '#888'} />
            <StatBox label="ADX" value={analysis.indicators?.adx?.toFixed(0) || '--'} color={analysis.indicators?.adx > 25 ? '#10b981' : '#666'} subtext={analysis.indicators?.adx > 25 ? 'Trending' : 'Ranging'} />
          </div>
          
          {/* Trade Plan */}
          {analysis.tradePlan && (
            <div style={{ background: analysis.tradePlan.direction === 'LONG' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${analysis.tradePlan.direction === 'LONG' ? '#10b981' : '#ef4444'}`, padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#888', letterSpacing: '1px', marginBottom: '10px' }}>TRADE PLAN — {analysis.tradePlan.direction}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>ENTRY</div>
                  <div style={{ fontSize: '14px', color: '#fff' }}>${analysis.tradePlan.entry.aggressive.toFixed(3)}</div>
                  <div style={{ fontSize: '10px', color: '#666' }}>Pullback: ${analysis.tradePlan.entry.pullback.toFixed(3)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>STOP LOSS</div>
                  <div style={{ fontSize: '14px', color: '#ef4444' }}>${analysis.tradePlan.stopLoss.toFixed(3)}</div>
                  <div style={{ fontSize: '10px', color: '#666' }}>Risk: {analysis.tradePlan.riskPercent}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>TARGETS</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>TP1: ${analysis.tradePlan.targets[0].toFixed(3)}</div>
                  <div style={{ fontSize: '11px', color: '#10b981' }}>TP2: ${analysis.tradePlan.targets[1].toFixed(3)}</div>
                  <div style={{ fontSize: '10px', color: '#666' }}>R:R = {analysis.tradePlan.riskReward}</div>
                </div>
              </div>
            </div>
          )}
          
          {!analysis.shouldTrade && analysis.noTradeReason && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', padding: '12px' }}>
              <span style={{ color: '#f59e0b', fontWeight: '600', fontSize: '11px' }}>⚠ NO TRADE: </span>
              <span style={{ color: '#888', fontSize: '11px' }}>{analysis.noTradeReason}</span>
            </div>
          )}
          
          {/* Backtest Button & Results */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
            <button onClick={handleRunBacktest} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 20px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>
              RUN BACKTEST (500 CANDLES)
            </button>
            {backtest && (
              <div style={{ flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>WIN RATE</div><div style={{ fontSize: '14px', color: parseFloat(backtest.winRate) > 50 ? '#10b981' : '#ef4444' }}>{backtest.winRate}%</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>TRADES</div><div style={{ fontSize: '14px', color: '#fff' }}>{backtest.totalTrades}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>P&L</div><div style={{ fontSize: '14px', color: parseFloat(backtest.totalPnL) > 0 ? '#10b981' : '#ef4444' }}>{backtest.totalPnL}%</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>MAX DD</div><div style={{ fontSize: '14px', color: '#ef4444' }}>{backtest.maxDrawdown}%</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>PROFIT FACTOR</div><div style={{ fontSize: '14px', color: parseFloat(backtest.profitFactor) > 1 ? '#10b981' : '#ef4444' }}>{backtest.profitFactor}</div></div>
              </div>
            )}
          </div>
          
          {backtest && showBacktest && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px' }}>BACKTEST RESULTS</div>
                <button onClick={() => setShowBacktest(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
                <div style={{ background: '#111', padding: '8px', textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>AVG WIN</div><div style={{ fontSize: '13px', color: '#10b981' }}>{backtest.avgWin}R</div></div>
                <div style={{ background: '#111', padding: '8px', textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>AVG LOSS</div><div style={{ fontSize: '13px', color: '#ef4444' }}>{backtest.avgLoss}R</div></div>
                <div style={{ background: '#111', padding: '8px', textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>EXPECTANCY</div><div style={{ fontSize: '13px', color: parseFloat(backtest.expectancy) > 0 ? '#10b981' : '#ef4444' }}>{backtest.expectancy}R</div></div>
                <div style={{ background: '#111', padding: '8px', textAlign: 'center' }}><div style={{ fontSize: '9px', color: '#666' }}>W/L</div><div style={{ fontSize: '13px', color: '#fff' }}>{backtest.winningTrades}/{backtest.losingTrades}</div></div>
              </div>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '6px' }}>RECENT TRADES</div>
              <div style={{ maxHeight: '120px', overflow: 'auto' }}>
                {backtest.trades.map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a1a', fontSize: '10px' }}>
                    <span style={{ color: t.direction === 'LONG' ? '#10b981' : '#ef4444' }}>{t.direction}</span>
                    <span style={{ color: '#666' }}>${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}</span>
                    <span style={{ color: '#666' }}>{t.reason}</span>
                    <span style={{ color: t.pnl > 0 ? '#10b981' : '#ef4444' }}>{t.pnlPercent > 0 ? '+' : ''}{t.pnlPercent.toFixed(1)}R</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Signal Bias */}
          <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: '#888', letterSpacing: '2px', marginBottom: '6px' }}>SIGNAL BIAS</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666', marginBottom: '6px' }}>{analysis.bias}</div>
            <div style={{ fontSize: '11px', color: '#666' }}>Confidence: <span style={{ color: '#fff', fontWeight: '600' }}>{analysis.confidence}%</span></div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '10px', fontSize: '11px' }}><span style={{ color: '#10b981' }}>▲ {analysis.bullScore}</span><span style={{ color: '#ef4444' }}>▼ {analysis.bearScore}</span></div>
          </div>
          
          {/* Indicators */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
            <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', marginBottom: '10px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <Badge label="RSI" value={analysis.indicators?.rsi?.toFixed(1) || '--'} status={analysis.indicators?.rsi < 30 ? 'bullish' : analysis.indicators?.rsi > 70 ? 'bearish' : 'neutral'} />
              <Badge label="STOCH" value={analysis.indicators?.stochK?.toFixed(1) || '--'} status={analysis.indicators?.stochK < 20 ? 'bullish' : analysis.indicators?.stochK > 80 ? 'bearish' : 'neutral'} />
              <Badge label="MACD" value={analysis.indicators?.macd?.toFixed(4) || '--'} status={analysis.indicators?.macd > analysis.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="ATR" value={`$${analysis.indicators?.atr?.toFixed(2) || '--'}`} status="neutral" />
            </div>
          </div>
          
          {/* Breakdown */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px' }}>
            <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', marginBottom: '10px' }}>CATEGORY BREAKDOWN</div>
            {Object.entries(analysis.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '3px' }}><span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span><span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span></div>
                <div style={{ height: '3px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} /></div>
              </div>
            ))}
          </div>
          
          {/* Signals */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px', flex: 1, overflow: 'auto', maxHeight: '280px' }}>
            <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', marginBottom: '10px' }}>SIGNALS ({analysis.signals?.length || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {(analysis.signals || []).map((s, i) => (
                <div key={i} style={{ fontSize: '9px', padding: '4px 6px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#444' }}><div>Live Binance • Funding updates every 8h • NFA</div><div>{update?.toLocaleTimeString()}</div></div>
    </div>
  );
}
