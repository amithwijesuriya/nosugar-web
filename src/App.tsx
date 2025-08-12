import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Banknote, FileText, FlameKindling, Link as LinkIcon, Plus, ShoppingCart, Watch, LineChart as LineChartIcon, Info, SlidersHorizontal, Shield } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";

// ——————————————————————————————————————————————
// nosugar — MVP (Admin Mode + Onboarding UI + activity bonus)
// DISCLAIMER: Educational demo only. Not medical advice.
// ——————————————————————————————————————————————

type Onboarding = {
  name: string;
  sex: "male" | "female" | "other" | "unspecified";
  age: number;
  heightCm: number;
  weightKg: number;
  ethnicity?: string;
  activity: "low" | "moderate" | "high";
  consentAnalytics: boolean;
  useEthnicityAdjustment?: boolean;
  onboarded?: boolean;
};

type LogEntry = { id: string; ts: number; item: string; sugarG: number; context?: string };
type Connections = { uberEats: boolean; banking: boolean; appleHealth: boolean };

type Settings = {
  baseMale: number; baseFemale: number; baseOther: number;
  bmiUnder: number; bmiOver: number; bmiObese: number;
  pancreasYouth: number; pancreasMiddle: number; pancreasSenior: number;
  ageChild: number; ageMiddle: number; ageSenior: number;
  actHigh: number; actLow: number;
  ethSouthAsian: number; ethEastAsian: number; ethHispanic: number; ethBlack: number;
  clampMin: number; clampMax: number;
};

const STORAGE_KEY = "nosugar_mvp_state_v3";

// ---------------------- tiny utils ----------------------
function loadState<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
function saveState<T>(key: string, value: T) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }
function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function cmToMeters(cm: number){ return cm/100 }
function clamp(n: number, lo: number, hi: number){ return Math.max(lo, Math.min(hi, n)) }
function round2(n: number){ return Math.round(n*100)/100 }
function startOfDay(d=new Date()){ const t=new Date(d); t.setHours(0,0,0,0); return t }
function addDays(d:Date, days:number){ const t=new Date(d); t.setDate(t.getDate()+days); return t }

// ---------------------- model (same as before) ----------------------
function bmiOf(heightCm: number, weightKg: number){ const h=cmToMeters(heightCm); return weightKg/(h*h) }
function pancreasCapacityFactor(age:number,bmi:number,S:Settings){
  let ageF=1; if(age<20) ageF=S.pancreasYouth; else if(age>=40&&age<60) ageF=S.pancreasMiddle; else if(age>=60) ageF=S.pancreasSenior;
  let bmiF=1; if(bmi>=25&&bmi<30) bmiF=S.bmiOver; else if(bmi>=30) bmiF=S.bmiObese;
  return clamp(ageF*bmiF,0.8,1.1);
}
function ethnicityFactor(eth:string|undefined,S:Settings){
  if(!eth) return 1;
  const e=(eth||"").toLowerCase();
  if(/(south asian|indian|pakistani|bangladesh|sri lanka)/.test(e)) return S.ethSouthAsian;
  if(/(east asian|chinese|japanese|korean)/.test(e)) return S.ethEastAsian;
  if(/(hispanic|latino)/.test(e)) return S.ethHispanic;
  if(/(african|black)/.test(e)) return S.ethBlack;
  return 1;
}
function activityFactor(level:Onboarding["activity"],S:Settings){ return level==="high"?S.actHigh:level==="moderate"?1.0:S.actLow }

function estimateDailySugarLimitG(user: Onboarding, S: Settings){
  let base = user.sex==="male"?S.baseMale:user.sex==="female"?S.baseFemale:S.baseOther;
  const _bmi=bmiOf(user.heightCm,user.weightKg);
  let bmiAdj=1; if(_bmi<18.5) bmiAdj=S.bmiUnder; else if(_bmi>=25&&_bmi<30) bmiAdj=S.bmiOver; else if(_bmi>=30) bmiAdj=S.bmiObese;
  const pancreasAdj=pancreasCapacityFactor(user.age,_bmi,S);
  let ageAdj=1; if(user.age<18) ageAdj=S.ageChild; else if(user.age>=45&&user.age<60) ageAdj=S.ageMiddle; else if(user.age>=60) ageAdj=S.ageSenior;
  const actAdj=activityFactor(user.activity,S);
  const ethAdj=user.useEthnicityAdjustment?ethnicityFactor(user.ethnicity,S):1;
  let limit = base*bmiAdj*pancreasAdj*ageAdj*actAdj*ethAdj;
  limit = Math.round(clamp(limit, S.clampMin, S.clampMax));
  return { total: limit, breakdown: {
    base, bmiAdj: round2(bmiAdj), pancreasAdj: round2(pancreasAdj),
    ageAdj: round2(ageAdj), actAdj: round2(actAdj), ethAdj: round2(ethAdj),
    bmi: round2(_bmi)
  }};
}

// ---------------------- last 7 days ----------------------
function rollupByDay(logs: LogEntry[]){
  const map = new Map<string, number>();
  for(const l of logs){
    const day = new Date(l.ts); day.setHours(0,0,0,0);
    const key = day.toISOString().slice(0,10);
    map.set(key, (map.get(key)||0) + l.sugarG);
  }
  return map;
}
function last7DaysSeries(logs:LogEntry[], dailyLimit:number){
  const series: { day:string, sugar:number, limit:number, over:boolean }[] = [];
  const end = startOfDay(new Date()); const start = addDays(end, -6); const roll = rollupByDay(logs);
  for(let d=0; d<7; d++){
    const day = addDays(start, d); const key = day.toISOString().slice(0,10);
    const sugar = roll.get(key) || 0;
    series.push({ day: key.slice(5), sugar, limit: dailyLimit, over: sugar > dailyLimit });
  }
  return series;
}

// ---------------------- NEW: activity bonus logic ----------------------
// 0.5 g per 10 active kcal; ignore <100 kcal; cap 20 g/day
function activitySugarBonusKcal(kcal:number): number {
  if (!kcal || kcal < 100) return 0;
  const grams = (kcal / 10) * 0.5;
  return Math.min(Math.round(grams), 20);
}
// Weekly cap: total bonus across last 7 days (incl today) ≤ 60 g
function weeklyCappedBonus(last6:number[], today:number): number {
  const used = last6.reduce((a,b)=>a+(b||0), 0);
  const remaining = Math.max(0, 60 - used);
  return Math.min(today, remaining);
}
// Soft cap: adjusted daily limit ≤ base + 30%
function applyDailyCap(base:number, bonus:number): number {
  const softCap = Math.round(base * 1.3);
  return Math.min(base + bonus, softCap);
}

// ---------------------- UI helpers ----------------------
function SectionTitle({ icon:Icon, title, subtitle }:{icon:any; title:string; subtitle?:string}){
  return (
    <div className="flex items-center gap-3 mb-4">
      <Icon className="w-5 h-5" />
      <div>
        <div className="text-xl font-semibold">{title}</div>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}
function ProgressBar({ value, max }:{ value:number; max:number }){
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${pct < 80 ? "bg-green-500" : pct < 100 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
function NumberField({ label, value, onChange }:{ label:string; value:number; onChange:(v:number)=>void }){
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input type="number" value={Number.isFinite(value)?value:0} onChange={(e)=>onChange(Number(e.target.value))} />
    </label>
  );
}

export default function App(){
  // Admin mode toggle (hidden by default)
  const [admin, setAdmin] = useState<boolean>(()=>loadState(STORAGE_KEY+":admin", false));
  useEffect(()=>saveState(STORAGE_KEY+":admin", admin),[admin]);

  // Settings (persisted)
  const [settings, setSettings] = useState<Settings>(()=>loadState(STORAGE_KEY+":settings",{
    baseMale:36, baseFemale:25, baseOther:30,
    bmiUnder:1.05, bmiOver:0.97, bmiObese:0.93,
    pancreasYouth:1.05, pancreasMiddle:0.95, pancreasSenior:0.9,
    ageChild:0.92, ageMiddle:0.97, ageSenior:0.92,
    actHigh:1.1, actLow:0.95,
    ethSouthAsian:0.97, ethEastAsian:0.98, ethHispanic:0.99, ethBlack:0.99,
    clampMin:18, clampMax:42,
  } as Settings));

  const [onboarding, setOnboarding] = useState<Onboarding>(()=>loadState(STORAGE_KEY+":user",{
    name:"", sex:"unspecified", age:30, heightCm:175, weightKg:75,
    ethnicity:"prefer-not-to-say", activity:"moderate", consentAnalytics:false, useEthnicityAdjustment:false,
    onboarded:false,
  } as Onboarding));

  const [connections, setConnections] = useState<Connections>(()=>loadState(STORAGE_KEY+":conn",{ uberEats:false, banking:false, appleHealth:false }));
  const [logs, setLogs] = useState<LogEntry[]>(()=>loadState(STORAGE_KEY+":logs",[] as LogEntry[]));

  // Activity kcal (manual for now) + weekly bonus history (persist)
  const [activityKcalToday, setActivityKcalToday] = useState<number>(()=>loadState(STORAGE_KEY+":actKcal",0));
  useEffect(()=>saveState(STORAGE_KEY+":actKcal",activityKcalToday),[activityKcalToday]);

  const [bonusHistory, setBonusHistory] = useState<Record<string, number>>(()=>loadState(STORAGE_KEY+":bonusHistory",{}));
  useEffect(()=>saveState(STORAGE_KEY+":bonusHistory",bonusHistory),[bonusHistory]);

  useEffect(()=>saveState(STORAGE_KEY+":user",onboarding),[onboarding]);
  useEffect(()=>saveState(STORAGE_KEY+":conn",connections),[connections]);
  useEffect(()=>saveState(STORAGE_KEY+":logs",logs),[logs]);
  useEffect(()=>saveState(STORAGE_KEY+":settings",settings),[settings]);

  // Base model
  const model = useMemo(()=>estimateDailySugarLimitG(onboarding, settings), [onboarding, settings]);
  const baseLimit = model.total;

  // Activity → bonus → weekly cap → daily soft cap
  const todayKey = startOfDay(new Date()).toISOString().slice(0,10);
  const rawBonusToday = activitySugarBonusKcal(activityKcalToday);
  const last6Keys = [...Array(6)].map((_, i)=> addDays(startOfDay(new Date()), -(i+1)).toISOString().slice(0,10));
  const last6Bonuses = last6Keys.map(k => bonusHistory[k] || 0);
  const weeklyRemaining = Math.max(0, 60 - last6Bonuses.reduce((a,b)=>a+b,0));
  const cappedBonusToday = weeklyCappedBonus(last6Bonuses, rawBonusToday);
  const dailyLimit = applyDailyCap(baseLimit, cappedBonusToday);

  // Persist today’s bonus
  useEffect(()=>{
    setBonusHistory(prev => (prev[todayKey] === cappedBonusToday ? prev : { ...prev, [todayKey]: cappedBonusToday }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cappedBonusToday, todayKey]);

  // Today consumption
  const todayStart = startOfDay(new Date());
  const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
  const todaySugar = logs.filter(l => l.ts >= todayStart.getTime() && l.ts <= todayEnd.getTime())
                         .reduce((a, b) => a + b.sugarG, 0);

  // Logging UI
  const [newItem, setNewItem] = useState("");
  const [newSugar, setNewSugar] = useState("");
  const addLog = () => {
    const grams = parseSugar(newSugar);
    if (!newItem || grams <= 0) return;
    setLogs([{ id: uid(), ts: Date.now(), item: newItem, sugarG: grams, context: "Manual" }, ...logs]);
    setNewItem(""); setNewSugar("");
  };
  const removeLog = (id: string) => setLogs(logs.filter(l => l.id !== id));

  const resetAll = () => {
    if (!confirm("Reset all data?")) return;
    setLogs([]);
    setOnboarding({
      name:"", sex:"unspecified", age:30, heightCm:175, weightKg:75,
      ethnicity:"prefer-not-to-say", activity:"moderate", consentAnalytics:false, useEthnicityAdjustment:false,
      onboarded:false,
    });
    setConnections({ uberEats:false, banking:false, appleHealth:false });
    setActivityKcalToday(0);
    setBonusHistory({});
  };

  const week = useMemo(()=>last7DaysSeries(logs, dailyLimit), [logs, dailyLimit]);
  const weekTotal = useMemo(()=>week.reduce((a,b)=>a+b.sugar,0), [week]);
  const weekTarget = dailyLimit * 7;

  // Auto-onboarding prompt (show once until completed)
  const [showOnboarding, setShowOnboarding] = useState<boolean>(!onboarding.onboarded);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900 p-6">
      <div className="max-w-6xl mx-auto grid gap-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white grid place-items-center font-bold shadow-sm">N</div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">nosugar</h1>
              <p className="text-xs text-muted-foreground">AI-powered preventive insights — demo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Admin toggle */}
            <Button variant={admin ? "default":"outline"} onClick={()=>setAdmin(!admin)} className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> {admin ? "Admin: ON" : "Admin: OFF"}
            </Button>
            <Button variant="outline" onClick={()=>setShowOnboarding(true)}>My Profile</Button>
            <Button variant="outline" onClick={resetAll}>Reset</Button>
            <ExportButton onboarding={onboarding} connections={connections} logs={logs} />
          </div>
        </header>

        {/* Budget Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Compact Profile summary */}
          <Card className="md:col-span-1 shadow-sm">
            <CardContent className="p-5">
              <SectionTitle icon={FileText} title="Profile" subtitle="Tap My Profile to edit" />
              <div className="text-sm space-y-1 text-muted-foreground">
                <div><span className="font-medium text-slate-900">{onboarding.name || "Guest"}</span></div>
                <div>Age {onboarding.age} • {onboarding.sex}</div>
                <div>{onboarding.heightCm} cm • {onboarding.weightKg} kg • {onboarding.activity} activity</div>
                {onboarding.ethnicity && <div>Ethnicity: {onboarding.ethnicity}</div>}
              </div>
              <div className="mt-3 text-xs text-muted-foreground flex gap-2 items-start">
                <Info className="w-4 h-4 mt-0.5" />
                <span>Estimates only, not medical advice.</span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 shadow-sm">
            <CardContent className="p-5">
              <SectionTitle icon={FlameKindling} title="Today’s Budget" subtitle="Personalized daily added sugar estimate" />
              <div className="grid md:grid-cols-3 gap-4 items-start">
                <div className="md:col-span-2">
                  <div className="flex items-end gap-3">
                    <div className="text-5xl font-bold">{dailyLimit}</div>
                    <div className="pb-2 text-muted-foreground">g / day</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Base {baseLimit} g + Activity bonus {cappedBonusToday} g (weekly left {weeklyRemaining} g)
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={todaySugar} max={dailyLimit} />
                    <div className="flex justify-between text-xs mt-1 text-muted-foreground">
                      <span>Consumed: {todaySugar} g</span>
                      <span>Remaining: {Math.max(0, dailyLimit - todaySugar)} g</span>
                    </div>
                  </div>
                  {todaySugar >= dailyLimit && (
                    <div className="mt-3 text-xs flex items-center gap-2 text-red-600">
                      <AlertCircle className="w-4 h-4" /> You’ve reached your demo limit. Consider water, fiber-rich snacks, or a walk.
                    </div>
                  )}
                </div>
                <ModelBreakdown model={model} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Data + Logging */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="shadow-sm">
            <CardContent className="p-5">
              <SectionTitle icon={Plus} title="Log sugar" subtitle="Add foods & drinks" />
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-3"><Input placeholder="e.g., Iced latte" value={newItem} onChange={e=>setNewItem(e.target.value)} /></div>
                <div className="col-span-1"><Input placeholder="g" value={newSugar} onChange={e=>setNewSugar(e.target.value)} /></div>
                <div className="col-span-1"><Button className="w-full" onClick={addLog}>Add</Button></div>
              </div>
              <div className="mt-4 max-h-64 overflow-auto divide-y">
                {logs.length===0 && <div className="text-sm text-muted-foreground">No entries yet. Add your first item above.</div>}
                {logs.map(l=>(
                  <div key={l.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium">{l.item}</div>
                      <div className="text-xs text-muted-foreground">{l.sugarG} g • {new Date(l.ts).toLocaleTimeString()} • {l.context}</div>
                    </div>
                    <Button variant="ghost" onClick={()=>setLogs(logs.filter(x=>x.id!==l.id))}>Remove</Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-5">
              <SectionTitle icon={LinkIcon} title="Data sources" subtitle="Prototype connections (non-functional)" />
              <div className="grid grid-cols-1 gap-3">
                <ConnectTile enabled={connections.uberEats} onToggle={(v)=>setConnections({...connections, uberEats:v})} title="Uber Eats & grocery receipts" subtitle="Parse order history for added sugar estimates" icon={ShoppingCart} />
                <ConnectTile enabled={connections.banking} onToggle={(v)=>setConnections({...connections, banking:v})} title="Banking (read-only)" subtitle="Infer food purchases via merchant codes" icon={Banknote} />
                <ConnectTile enabled={connections.appleHealth} onToggle={(v)=>setConnections({...connections, appleHealth:v})} title="Apple Watch / Health" subtitle="Use motion/meal timing for nudges (web demo only)" icon={Watch} />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Real device sync (Apple Health/Fitbit) requires native apps. This demo uses manual entry for activity.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick presets & CSV */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <SectionTitle icon={Plus} title="Speed add & import" subtitle="Quick presets or CSV upload" />
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-2">Quick presets</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p=>(
                    <Button key={p.label} variant="outline" onClick={()=>setQuickAdd(setLogs, p.label, p.grams)}>
                      {p.label} ({p.grams}g)
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Import CSV (columns: date,item,sugarG)</div>
                <ImportCsv onImport={(rows)=>addLogs(rows, setLogs)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Activity today (manual for now) */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <SectionTitle icon={Info} title="Activity today" subtitle="Manual entry until device sync exists" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Active energy (kcal)</label>
                <Input type="number" min={0} value={activityKcalToday} onChange={e=>setActivityKcalToday(Number(e.target.value||0))} placeholder="e.g., 300" />
              </div>
              <div className="sm:col-span-2 text-sm text-muted-foreground flex items-end">
                <div>Bonus applied today: <span className="font-medium">{cappedBonusToday} g</span> (raw {rawBonusToday} g). Weekly left: <span className="font-medium">{weeklyRemaining} g</span> (cap 60 g / 7d).</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Week View */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <SectionTitle icon={LineChartIcon} title="Week view" subtitle={`Daily sugar vs. your current limit — Week total: ${weekTotal} g / ${weekTarget} g`} />
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ opacity: 0.2 }} />
                  <ReferenceLine y={dailyLimit} strokeDasharray="3 3" />
                  <Bar dataKey="sugar" name="Sugar (g)">
                    {week.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.over ? "#ef4444" : "#22c55e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Admin-only: Model settings */}
        {admin && (
          <Card className="shadow-sm border-indigo-200">
            <CardContent className="p-5">
              <SectionTitle icon={SlidersHorizontal} title="Model settings (Admin)" subtitle="Tune demo coefficients — hidden from users" />
              <div className="grid md:grid-cols-4 gap-3 text-sm">
                <NumberField label="Base male" value={settings.baseMale} onChange={(v)=> setSettings({...settings, baseMale: v})} />
                <NumberField label="Base female" value={settings.baseFemale} onChange={(v)=> setSettings({...settings, baseFemale: v})} />
                <NumberField label="Base other" value={settings.baseOther} onChange={(v)=> setSettings({...settings, baseOther: v})} />
                <NumberField label="Clamp min" value={settings.clampMin} onChange={(v)=> setSettings({...settings, clampMin: v})} />
                <NumberField label="Clamp max" value={settings.clampMax} onChange={(v)=> setSettings({...settings, clampMax: v})} />
                <NumberField label="BMI <18.5" value={settings.bmiUnder} onChange={(v)=> setSettings({...settings, bmiUnder: v})} />
                <NumberField label="BMI 25–30" value={settings.bmiOver} onChange={(v)=> setSettings({...settings, bmiOver: v})} />
                <NumberField label=">=30" value={settings.bmiObese} onChange={(v)=> setSettings({...settings, bmiObese: v})} />
                <NumberField label="Pancreas <20y" value={settings.pancreasYouth} onChange={(v)=> setSettings({...settings, pancreasYouth: v})} />
                <NumberField label="Pancreas 40–60y" value={settings.pancreasMiddle} onChange={(v)=> setSettings({...settings, pancreasMiddle: v})} />
                <NumberField label=">=60y" value={settings.pancreasSenior} onChange={(v)=> setSettings({...settings, pancreasSenior: v})} />
                <NumberField label="Age <18y" value={settings.ageChild} onChange={(v)=> setSettings({...settings, ageChild: v})} />
                <NumberField label="Age 45–60y" value={settings.ageMiddle} onChange={(v)=> setSettings({...settings, ageMiddle: v})} />
                <NumberField label=">=60y" value={settings.ageSenior} onChange={(v)=> setSettings({...settings, ageSenior: v})} />
                <NumberField label="Activity high" value={settings.actHigh} onChange={(v)=> setSettings({...settings, actHigh: v})} />
                <NumberField label="Activity low" value={settings.actLow} onChange={(v)=> setSettings({...settings, actLow: v})} />
                <NumberField label="Eth South Asian" value={settings.ethSouthAsian} onChange={(v)=> setSettings({...settings, ethSouthAsian: v})} />
                <NumberField label="Eth East Asian" value={settings.ethEastAsian} onChange={(v)=> setSettings({...settings, ethEastAsian: v})} />
                <NumberField label="Eth Hispanic" value={settings.ethHispanic} onChange={(v)=> setSettings({...settings, ethHispanic: v})} />
                <NumberField label="Eth Black" value={settings.ethBlack} onChange={(v)=> setSettings({...settings, ethBlack: v})} />
              </div>
            </CardContent>
          </Card>
        )}

        <footer className="text-xs text-muted-foreground text-center py-6">
          Built as a product exploration by Amith Wijesuriya & ChatGPT. Educational only — not medical advice.
        </footer>
      </div>

      {/* Onboarding modal */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="p-5 border-b">
              <div className="text-lg font-semibold">Welcome to nosugar</div>
              <div className="text-xs text-muted-foreground">Tell us a bit about you to personalize your daily estimate.</div>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2">
                <div className="text-xs text-muted-foreground">Name</div>
                <Input value={onboarding.name} onChange={(e)=>setOnboarding({...onboarding, name:e.target.value})} placeholder="Optional" />
              </label>
              <label>
                <div className="text-xs text-muted-foreground">Sex</div>
                <Select value={onboarding.sex} onValueChange={(v:any)=>setOnboarding({...onboarding, sex:v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Unspecified</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label>
                <div className="text-xs text-muted-foreground">Age</div>
                <Input type="number" min={5} max={100} value={onboarding.age} onChange={(e)=>setOnboarding({...onboarding, age:Number(e.target.value)})} />
              </label>
              <label>
                <div className="text-xs text-muted-foreground">Height (cm)</div>
                <Input type="number" min={100} max={230} value={onboarding.heightCm} onChange={(e)=>setOnboarding({...onboarding, heightCm:Number(e.target.value)})} />
              </label>
              <label>
                <div className="text-xs text-muted-foreground">Weight (kg)</div>
                <Input type="number" min={25} max={250} value={onboarding.weightKg} onChange={(e)=>setOnboarding({...onboarding, weightKg:Number(e.target.value)})} />
              </label>
              <label className="col-span-2">
                <div className="text-xs text-muted-foreground">Activity level</div>
                <Select value={onboarding.activity} onValueChange={(v:any)=>setOnboarding({...onboarding, activity:v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="col-span-2">
                <div className="text-xs text-muted-foreground">Ethnicity (optional)</div>
                <Input value={onboarding.ethnicity||""} onChange={(e)=>setOnboarding({...onboarding, ethnicity:e.target.value})} placeholder="Prefer not to say" />
              </label>
              <div className="col-span-2 flex items-center gap-2 mt-1">
                <Checkbox checked={onboarding.consentAnalytics} onCheckedChange={(v:any)=>setOnboarding({...onboarding, consentAnalytics:!!v})} />
                <span className="text-xs text-muted-foreground">I consent to anonymous analytics for model improvement (demo)</span>
              </div>
              <div className="col-span-2 flex items-center gap-2 mt-1">
                <Checkbox checked={!!onboarding.useEthnicityAdjustment} onCheckedChange={(v:any)=>setOnboarding({...onboarding, useEthnicityAdjustment:!!v})} />
                <span className="text-xs text-muted-foreground">Enable ethnicity-based adjustment (experimental)</span>
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-2 bg-slate-50">
              <Button variant="outline" onClick={()=>setShowOnboarding(false)}>Cancel</Button>
              <Button onClick={()=>{ setOnboarding({...onboarding, onboarded:true}); setShowOnboarding(false); }}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Data helpers
// -----------------------------------------------------------------------------
const PRESETS = [
  { label: "Soda 12oz", grams: 39 },
  { label: "Sweetened yogurt (cup)", grams: 18 },
  { label: "Chocolate bar", grams: 26 },
  { label: "Sports drink 20oz", grams: 34 },
  { label: "Iced latte (sweet)", grams: 24 },
  { label: "Cookie", grams: 12 },
];

function addLogs(rows: { item: string, sugarG: number, ts?: number, context?: string }[], setLogs?: React.Dispatch<React.SetStateAction<LogEntry[]>>){
  const apply = setLogs || (globalThis as any).__setLogs;
  if (!apply) return;
  const mapped = rows.filter(r=> r.item && r.sugarG>0).map(r=> ({
    id: uid(),
    ts: r.ts || Date.now(),
    item: r.item,
    sugarG: Math.round(Number(r.sugarG)),
    context: r.context || "Import"
  }));
  apply(prev => [...mapped, ...prev]);
}

function parseCsv(text: string){
  const lines = text.split(/\r?\n/).filter(l=> l.trim().length);
  if (!lines.length) return [] as { ts:number, item:string, sugarG:number }[];
  const header = lines[0].toLowerCase();
  const hasHeader = /(date|item|sugar)/.test(header);
  const rows = (hasHeader? lines.slice(1): lines);
  const out: { ts:number, item:string, sugarG:number }[] = [];
  for (const line of rows){
    const cells = line.split(",");
    if (cells.length < 2) continue;
    let dateStr = ""; let item = ""; let sugarStr = "";
    if (cells.length === 2){ item = cells[0]; sugarStr = cells[1] }
    else { dateStr = cells[0]; item = cells[1]; sugarStr = cells[2] }
    const ts = dateStr? Date.parse(dateStr) : Date.now();
    const sugarG = Number(String(sugarStr).replace(/[^0-9.]/g, ""));
    if (!item || !sugarG) continue;
    out.push({ ts: isNaN(ts)? Date.now(): ts, item: item.trim(), sugarG: Math.round(sugarG) });
  }
  return out;
}

function ImportCsv({ onImport }:{ onImport:(rows:{ item:string, sugarG:number, ts?:number }[])=>void }){
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="file" accept=".csv,text/csv" onChange={async (e)=>{
        const f = e.target.files?.[0]; if (!f) return;
        const text = await f.text();
        const rows = parseCsv(text);
        onImport(rows);
        alert(`Imported ${rows.length} rows`);
      }} />
      <span className="text-muted-foreground">Choose CSV…</span>
    </label>
  );
}

// ---------------------- tiny UI helpers ----------------------
function parseSugar(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}
function setQuickAdd(setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>, label: string, grams: number) {
  setLogs(prev => [{ id: uid(), ts: Date.now(), item: label, sugarG: grams, context: "Quick" }, ...prev ]);
}
function ConnectTile({ enabled, onToggle, title, subtitle, icon: Icon }:
  { enabled: boolean, onToggle: (v: boolean) => void, title: string, subtitle: string, icon: any }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-2xl border ${enabled ? "bg-slate-50" : "bg-white"}`}>
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5" />
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      <Button variant={enabled ? "default" : "outline"} onClick={() => onToggle(!enabled)}>{enabled ? "Connected" : "Connect"}</Button>
    </div>
  );
}
function ExportButton({ onboarding, connections, logs }: { onboarding: Onboarding, connections: Connections, logs: LogEntry[] }) {
  const download = () => {
    const rollups = Array.from(rollupByDay(logs)).map(([day, sugar]) => ({ day, sugar }));
    const blob = new Blob([JSON.stringify({ onboarding, connections, logs, rollups }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nosugar-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };
  return <Button variant="outline" onClick={download}>Export JSON</Button>;
}
function ModelBreakdown({ model }: { model: { total: number, breakdown: Record<string, number> } }) {
  const b = model.breakdown as any;
  return (
    <div className="rounded-2xl border p-3 text-sm">
      <div className="font-medium mb-1">Model inputs (demo)</div>
      <div className="grid grid-cols-2 gap-y-1 text-xs text-muted-foreground">
        <span>Base:</span><span className="text-right">{b.base} g</span>
        <span>BMI adj:</span><span className="text-right">× {b.bmiAdj}</span>
        <span>Pancreas adj:</span><span className="text-right">× {b.pancreasAdj}</span>
        <span>Age adj:</span><span className="text-right">× {b.ageAdj}</span>
        <span>Activity adj:</span><span className="text-right">× {b.actAdj}</span>
        <span>Ethnicity adj:</span><span className="text-right">× {b.ethAdj}</span>
        <span>BMI:</span><span className="text-right">{b.bmi}</span>
      </div>
      <div className="mt-2 text-xs">Max sugar (demo): <span className="font-semibold">{model.total} g/day</span></div>
    </div>
  );
}
