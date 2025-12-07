import React, { useState, useEffect, useMemo, useRef } from 'react';

// Chart Component with Real Binance Data
const Chart = () => {
  const containerRef = useRef(null);

  useEffect(() => {
    let chart;
    let ws;

    const init = async () => {
      const { createChart } = await import('https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.mjs');
      
      if (!containerRef.current) return;

      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 500,
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
      const ema50 = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 });

      try {
        const res = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=200');
        const data = await res.json();
        
        const candles = data.map(d => ({
          time: d[0] / 1000,
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
        }));

        candleSeries.setData(candles);

        const calcEMA = (data, period) => {
          const k = 2 / (period + 1);
          let ema = data[0].close;
          return data.map((d, i) => {
            if (i === 0) return { time: d.time, value: ema };
            ema = d.close * k + ema * (1 - k);
            return { time: d.time, value: ema };
          });
        };

        ema9.setData(calcEMA(candles, 9));
        ema21.setData(calcEMA(candles, 21));
        ema50.setData(calcEMA(candles, 50));
        chart.timeScale().fitContent();

        // Live updates
        ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_5m');
        ws.onmessage = (e) => {
          const k = JSON.parse(e.data).k;
          candleSeries.update({
            time: k.t / 1000,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          });
        };
      } catch (err) {
        console.error('Fetch error:', err);
      }

      const resize = () => chart?.applyOptions({ width: containerRef.current?.clientWidth });
      window.addEventListener('resize', resize);
      
      return () => {
        window.removeEventListener('resize', resize);
        ws?.close();
        chart?.remove();
      };
    };

    init();
    return () => { ws?.close(); chart?.remove(); };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '500px' }} />;
};

const calcEMA = (data, period) => {
  const k = 2 / (period + 1);
  let ema = data[0]?.close || 0;
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
  const smoothD = smoothK.map((_, i) => i < 3 ? smoothK[i] : smoothK.slice(i - 2, i + 1).reduce((a, b) => a + b, 0) / 3);
  return { k: smoothK, d: smoothD };
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
  if (i < period - 1) return { width: 0 };
  const slice = data.slice(i - period + 1, i + 1), sma = slice.reduce((a, b) => a + b.close, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b.close - sma, 2), 0) / period);
  return { upper: sma + mult * std, lower: sma - mult * std, width: (mult * std * 2) / sma };
});

const calcVWAP = (data) => { let cV = 0, cVP = 0; return data.map(d => { const tp = (d.high + d.low + d.close) / 3; cV += d.volume; cVP += tp * d.volume; return cV === 0 ? tp : cVP / cV; }); };
const calcOBV = (data) => { let obv = 0; return data.map((d, i) => { if (i === 0) return 0; if (d.close > data[i-1].close) obv += d.volume; else if (d.close < data[i-1].close) obv -= d.volume; return obv; }); };

const analyzeSignals = (data) => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {} };
  
  const latest = data[data.length - 1], prev = data[data.length - 2], prev5 = data[data.length - 6];
  const ema9 = calcEMA(data, 9), ema21 = calcEMA(data, 21), ema50 = calcEMA(data, 50);
  const rsi = calcRSI(data), stochRSI = calcStochRSI(data);
  const { macd, signal: macdSig, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data), bb = calcBB(data), vwap = calcVWAP(data), obv = calcOBV(data);
  
  let bullScore = 0, bearScore = 0;
  const signals = [];
  const breakdown = { trend: { score: 0, max: 25, signals: [] }, momentum: { score: 0, max: 25, signals: [] }, volume: { score: 0, max: 15, signals: [] }, volatility: { score: 0, max: 15, signals: [] }, priceAction: { score: 0, max: 20, signals: [] } };
  
  const le9 = ema9[ema9.length - 1], le21 = ema21[ema21.length - 1], le50 = ema50[ema50.length - 1];
  const pe9 = ema9[ema9.length - 2], pe21 = ema21[ema21.length - 2];
  
  if (le9 > le21 && le21 > le50) { bullScore += 8; breakdown.trend.score += 8; breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs stacked bullish' }); }
  else if (le9 < le21 && le21 < le50) { bearScore += 8; breakdown.trend.score -= 8; breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs stacked bearish' }); }
  if (latest.close > le9 && latest.close > le21) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: 'Price above EMAs' }); }
  else if (latest.close < le9 && latest.close < le21) { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: 'Price below EMAs' }); }
  if (pe9 <= pe21 && le9 > le21) { bullScore += 7; breakdown.trend.score += 7; breakdown.trend.signals.push({ type: 'bullish', text: 'Golden cross' }); }
  if (pe9 >= pe21 && le9 < le21) { bearScore += 7; breakdown.trend.score -= 7; breakdown.trend.signals.push({ type: 'bearish', text: 'Death cross' }); }
  
  const lADX = adx[adx.length - 1], lPlus = plusDI[plusDI.length - 1], lMinus = minusDI[minusDI.length - 1];
  if (lADX > 25) { if (lPlus > lMinus) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: `Strong trend (ADX ${lADX.toFixed(0)})` }); } else { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: `Strong trend (ADX ${lADX.toFixed(0)})` }); } }
  
  const lRSI = rsi[rsi.length - 1], lStochK = stochRSI.k[stochRSI.k.length - 1];
  const lMACD = macd[macd.length - 1], lSig = macdSig[macdSig.length - 1];
  const lHist = histogram[histogram.length - 1], pHist = histogram[histogram.length - 2];
  
  if (lRSI < 30) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold (${lRSI.toFixed(0)})` }); }
  else if (lRSI > 70) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought (${lRSI.toFixed(0)})` }); }
  else if (lRSI > 50) { bullScore += 2; breakdown.momentum.score += 2; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI bullish (${lRSI.toFixed(0)})` }); }
  else { bearScore += 2; breakdown.momentum.score -= 2; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI bearish (${lRSI.toFixed(0)})` }); }
  
  if (lStochK < 20) { bullScore += 5; breakdown.momentum.score += 5; breakdown.momentum.signals.push({ type: 'bullish', text: 'StochRSI oversold' }); }
  else if (lStochK > 80) { bearScore += 5; breakdown.momentum.score -= 5; breakdown.momentum.signals.push({ type: 'bearish', text: 'StochRSI overbought' }); }
  
  const pMACD = macd[macd.length - 2], pSig = macdSig[macdSig.length - 2];
  if (pMACD <= pSig && lMACD > lSig) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD bullish cross' }); }
  if (pMACD >= pSig && lMACD < lSig) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD bearish cross' }); }
  if (lHist > 0 && lHist > pHist) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD momentum up' }); }
  else if (lHist < 0 && lHist < pHist) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD momentum down' }); }
  
  const lOBV = obv[obv.length - 1], pOBV = obv[obv.length - 6], lVWAP = vwap[vwap.length - 1];
  if (lOBV > pOBV && latest.close > prev5.close) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'OBV confirming' }); }
  else if (lOBV < pOBV && latest.close < prev5.close) { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'OBV confirming' }); }
  if (latest.close > lVWAP) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'Above VWAP' }); }
  else { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'Below VWAP' }); }
  
  const lBB = bb[bb.length - 1], lATR = atr[atr.length - 1];
  if (lBB.width < 0.03) breakdown.volatility.signals.push({ type: 'neutral', text: 'BB squeeze' });
  if (latest.close <= lBB.lower) { bullScore += 5; breakdown.volatility.score += 5; breakdown.volatility.signals.push({ type: 'bullish', text: 'At lower BB' }); }
  else if (latest.close >= lBB.upper) { bearScore += 5; breakdown.volatility.score -= 5; breakdown.volatility.signals.push({ type: 'bearish', text: 'At upper BB' }); }
  
  const body = Math.abs(latest.close - latest.open), uWick = latest.high - Math.max(latest.close, latest.open), lWick = Math.min(latest.close, latest.open) - latest.low;
  if (lWick > body * 2 && uWick < body * 0.5 && latest.close > latest.open) { bullScore += 6; breakdown.priceAction.score += 6; breakdown.priceAction.signals.push({ type: 'bullish', text: 'Hammer' }); }
  if (uWick > body * 2 && lWick < body * 0.5 && latest.close < latest.open) { bearScore += 6; breakdown.priceAction.score -= 6; breakdown.priceAction.signals.push({ type: 'bearish', text: 'Shooting star' }); }
  
  Object.values(breakdown).forEach(c => c.signals.forEach(s => signals.push(s)));
  const totalScore = bullScore - bearScore;
  let bias = 'NEUTRAL'; if (totalScore > 15) bias = 'LONG'; else if (totalScore < -15) bias = 'SHORT';
  
  return { bias, confidence: Math.min(Math.abs(totalScore), 100).toFixed(0), bullScore, bearScore, signals, breakdown, indicators: { rsi: lRSI, stochK: lStochK, macd: lMACD, macdSignal: lSig, adx: lADX, atr: lATR, bbWidth: lBB.width * 100, price: latest.close } };
};

const Badge = ({ label, value, status }) => {
  const c = { bullish: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' }, bearish: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444' }, neutral: { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' } }[status] || { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' };
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '8px 12px' }}><span style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '14px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

export default function Dashboard() {
  const [data, setData] = useState([]);
  const [price, setPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(0);
  const [update, setUpdate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=5m&limit=100');
        const klines = await res.json();
        const parsed = klines.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
        setData(parsed);
        setPrice(parsed[parsed.length - 1].close);
        setPriceChange(((parsed[parsed.length - 1].close - parsed[parsed.length - 2].close) / parsed[parsed.length - 2].close) * 100);
        setLoading(false);
        setUpdate(new Date());
      } catch (e) { setLoading(false); }
    };
    fetchData();
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_5m');
    ws.onmessage = (e) => { const k = JSON.parse(e.data).k; setPrice(parseFloat(k.c)); setUpdate(new Date()); };
    const interval = setInterval(fetchData, 30000);
    return () => { ws.close(); clearInterval(interval); };
  }, []);

  const analysis = useMemo(() => analyzeSignals(data), [data]);

  if (loading) return <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#10b981' }}><div>◉ LOADING...</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono", monospace', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px', fontWeight: '700' }}>SOL/USDT</span>
          <span style={{ background: '#10b981', color: '#000', padding: '2px 8px', fontSize: '10px', fontWeight: '600' }}>5M</span>
          <span style={{ background: '#3b82f6', color: '#000', padding: '2px 8px', fontSize: '10px', fontWeight: '600' }}>LIVE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ fontSize: '24px', fontWeight: '600' }}>${price?.toFixed(2)}</span>
          <span style={{ color: priceChange >= 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%</span>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', minHeight: 'calc(100vh - 120px)' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '8px' }}><Chart /></div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', letterSpacing: '2px', marginBottom: '8px' }}>SIGNAL BIAS</div>
            <div style={{ fontSize: '36px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666', marginBottom: '8px' }}>{analysis.bias}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>Confidence: <span style={{ color: '#fff', fontWeight: '600' }}>{analysis.confidence}%</span></div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '12px', fontSize: '11px' }}><span style={{ color: '#10b981' }}>▲ {analysis.bullScore}</span><span style={{ color: '#ef4444' }}>▼ {analysis.bearScore}</span></div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <Badge label="RSI" value={analysis.indicators?.rsi?.toFixed(1) || '--'} status={analysis.indicators?.rsi < 30 ? 'bullish' : analysis.indicators?.rsi > 70 ? 'bearish' : 'neutral'} />
              <Badge label="STOCH" value={analysis.indicators?.stochK?.toFixed(1) || '--'} status={analysis.indicators?.stochK < 20 ? 'bullish' : analysis.indicators?.stochK > 80 ? 'bearish' : 'neutral'} />
              <Badge label="ADX" value={analysis.indicators?.adx?.toFixed(1) || '--'} status={analysis.indicators?.adx > 25 ? 'bullish' : 'neutral'} />
              <Badge label="ATR" value={analysis.indicators?.atr?.toFixed(3) || '--'} status="neutral" />
              <Badge label="MACD" value={analysis.indicators?.macd?.toFixed(4) || '--'} status={analysis.indicators?.macd > analysis.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="BB%" value={`${analysis.indicators?.bbWidth?.toFixed(1) || '--'}%`} status="neutral" />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>BREAKDOWN</div>
            {Object.entries(analysis.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}><span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span><span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span></div>
                <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} /></div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px', flex: 1, overflow: 'auto', maxHeight: '250px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>SIGNALS ({analysis.signals?.length || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(analysis.signals || []).slice(0, 14).map((s, i) => (
                <div key={i} style={{ fontSize: '10px', padding: '5px 8px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#444' }}><div>Live Binance • WebSocket • NFA</div><div>{update?.toLocaleTimeString()}</div></div>
    </div>
  );
}
