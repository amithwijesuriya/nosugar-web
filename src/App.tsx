import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Banknote, FileText, FlameKindling, Link as LinkIcon, Plus, ShoppingCart, Watch, LineChart as LineChartIcon, Info, SlidersHorizontal } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ——————————————————————————————————————————————
// nosugar — lightweight MVP prototype (v3)
// WHAT'S NEW
// - Week view: colored bars (green under target, red over)
// - Week summary: total vs 7-day rolling target
// - Model Settings panel: tune key coefficients live
// - Model remains non-clinical; for product exploration only
// DISCLAIMER: Educational demo only. Not medical advice.
// ——————————————————————————————————————————————

// Types
type Onboarding = {
  name: string
  sex: "male" | "female" | "other" | "unspecified"
  age: number
  heightCm: number
  weightKg: number
  ethnicity?: string
  activity: "low" | "moderate" | "high"
  consentAnalytics: boolean
  useEthnicityAdjustment?: boolean // user must opt-in
}

type LogEntry = {
  id: string
  ts: number // epoch ms
  item: string
  sugarG: number
  context?: string // e.g., "UberEats", "Manual", "Receipt"
}

type Connections = {
  uberEats: boolean
  banking: boolean
  appleHealth: boolean
}

// Model Settings (tunable)
type Settings = {
  baseMale: number
  baseFemale: number
  baseOther: number
  bmiUnder: number // <18.5
  bmiOver: number // 25–30
  bmiObese: number // >=30
  pancreasYouth: number // <20
  pancreasMiddle: number // 40–60
  pancreasSenior: number // >=60
  ageChild: number // <18
  ageMiddle: number // 45–60
  ageSenior: number // >=60
  actHigh: number
  actLow: number
  ethSouthAsian: number
  ethEastAsian: number
  ethHispanic: number
  ethBlack: number
  clampMin: number
  clampMax: number
}

// Utilities
const STORAGE_KEY = "nosugar_mvp_state_v3";

function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveState<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function cmToMeters(cm: number) { return cm / 100 }
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }
function round2(n: number) { return Math.round(n * 100) / 100 }

// ——————————————————————————————————————————————
// MODEL HELPERS (placeholder logic)
// These are conservative, non-clinical placeholders. Replace with
// peer-reviewed, validated models before any real-world use.
// ——————————————————————————————————————————————
function bmiOf(heightCm: number, weightKg: number) {
  const h = cmToMeters(heightCm)
  return weightKg / (h * h)
}

function pancreasCapacityFactor(age: number, bmi: number, S: Settings) {
  let ageFactor = 1
  if (age < 20) ageFactor = S.pancreasYouth
  else if (age >= 40 && age < 60) ageFactor = S.pancreasMiddle
  else if (age >= 60) ageFactor = S.pancreasSenior

  let bmiFactor = 1
  if (bmi >= 25 && bmi < 30) bmiFactor = S.bmiOver
  else if (bmi >= 30) bmiFactor = S.bmiObese

  return clamp(ageFactor * bmiFactor, 0.8, 1.1)
}

// Optional ethnicity factor (experimental). Conservative and small effect.
function ethnicityFactor(ethnicity: string | undefined, S: Settings) {
  if (!ethnicity) return 1
  const e = (ethnicity || "").toLowerCase()
  if (/(south asian|indian|pakistani|bangladesh|sri lanka)/.test(e)) return S.ethSouthAsian
  if (/(east asian|chinese|japanese|korean)/.test(e)) return S.ethEastAsian
  if (/(hispanic|latino)/.test(e)) return S.ethHispanic
  if (/(african|black)/.test(e)) return S.ethBlack
  return 1
}

function activityFactor(level: Onboarding["activity"], S: Settings) {
  return level === "high" ? S.actHigh : level === "moderate" ? 1.0 : S.actLow
}

// Core daily limit estimate (grams of ADDED sugar).
function estimateDailySugarLimitG(user: Onboarding, S: Settings): { total: number, breakdown: Record<string, number> } {
  // Base by sex from public rule-of-thumb ranges
  let base = user.sex === "male" ? S.baseMale : user.sex === "female" ? S.baseFemale : S.baseOther

  const _bmi = bmiOf(user.heightCm, user.weightKg)

  // Weight the base slightly by BMI category to be conservative
  let bmiAdj = 1
  if (_bmi < 18.5) bmiAdj = S.bmiUnder
  else if (_bmi >= 25 && _bmi < 30) bmiAdj = S.bmiOver
  else if (_bmi >= 30) bmiAdj = S.bmiObese

  // Pancreas/beta-cell proxy
  const pancreasAdj = pancreasCapacityFactor(user.age, _bmi, S)

  // Age-only small effect (independent of pancreas proxy) for simplicity
  let ageAdj = 1
  if (user.age < 18) ageAdj = S.ageChild
  else if (user.age >= 45 && user.age < 60) ageAdj = S.ageMiddle
  else if (user.age >= 60) ageAdj = S.ageSenior

  // Activity
  const actAdj = activityFactor(user.activity, S)

  // Ethnicity (optional)
  const ethAdj = user.useEthnicityAdjustment ? ethnicityFactor(user.ethnicity, S) : 1

  let limit = base * bmiAdj * pancreasAdj * ageAdj * actAdj * ethAdj
  limit = Math.round(clamp(limit, S.clampMin, S.clampMax))

  return {
    total: limit,
    breakdown: {
      base,
      bmiAdj: round2(bmiAdj),
      pancreasAdj: round2(pancreasAdj),
      ageAdj: round2(ageAdj),
      actAdj: round2(actAdj),
      ethAdj: round2(ethAdj),
      bmi: round2(_bmi)
    }
  }
}

// ——————————————————————————————————————————————
// WEEK DATA
// ——————————————————————————————————————————————
function startOfDay(d = new Date()) {
  const t = new Date(d)
  t.setHours(0,0,0,0)
  return t
}
function addDays(d: Date, days: number) {
  const t = new Date(d)
  t.setDate(t.getDate() + days)
  return t
}

function rollupByDay(logs: LogEntry[]) {
  const map = new Map<string, number>()
  for (const l of logs) {
    const day = new Date(l.ts); day.setHours(0,0,0,0)
    const key = day.toISOString().slice(0,10)
    map.set(key, (map.get(key) || 0) + l.sugarG)
  }
  return map
}

function last7DaysSeries(logs: LogEntry[], dailyLimit: number) {
  const series: { day: string, sugar: number, limit: number, over: boolean }[] = []
  const end = startOfDay(new Date())
  const start = addDays(end, -6)
  const roll = rollupByDay(logs)
  for (let d = 0; d < 7; d++) {
    const day = addDays(start, d)
    const key = day.toISOString().slice(0,10)
    const sugar = roll.get(key) || 0
    series.push({ day: key.slice(5), sugar, limit: dailyLimit, over: sugar > dailyLimit })
  }
  return series
}

// Components
function SectionTitle({ icon: Icon, title, subtitle }: { icon: any, title: string, subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <Icon className="w-5 h-5" />
      <div>
        <div className="text-xl font-semibold">{title}</div>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  )
}

function ProgressBar({ value, max }: { value: number, max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${pct < 80 ? "bg-green-500" : pct < 100 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function App() {
  // Settings (persisted)
  const [settings, setSettings] = useState<Settings>(() => loadState<Settings>(STORAGE_KEY + ":settings", {
    baseMale: 36, baseFemale: 25, baseOther: 30,
    bmiUnder: 1.05, bmiOver: 0.97, bmiObese: 0.93,
    pancreasYouth: 1.05, pancreasMiddle: 0.95, pancreasSenior: 0.9,
    ageChild: 0.92, ageMiddle: 0.97, ageSenior: 0.92,
    actHigh: 1.1, actLow: 0.95,
    ethSouthAsian: 0.97, ethEastAsian: 0.98, ethHispanic: 0.99, ethBlack: 0.99,
    clampMin: 18, clampMax: 42,
  }))

  const [onboarding, setOnboarding] = useState<Onboarding>(() => loadState<Onboarding>(STORAGE_KEY + ":user", {
    name: "",
    sex: "unspecified",
    age: 30,
    heightCm: 175,
    weightKg: 75,
    ethnicity: "prefer-not-to-say",
    activity: "moderate",
    consentAnalytics: false,
    useEthnicityAdjustment: false,
  }))
  const [connections, setConnections] = useState<Connections>(() => loadState<Connections>(STORAGE_KEY + ":conn", {
    uberEats: false,
    banking: false,
    appleHealth: false,
  }))
  const [logs, setLogs] = useState<LogEntry[]>(() => loadState<LogEntry[]>(STORAGE_KEY + ":logs", []))

  useEffect(() => saveState(STORAGE_KEY + ":user", onboarding), [onboarding])
  useEffect(() => saveState(STORAGE_KEY + ":conn", connections), [connections])
  useEffect(() => saveState(STORAGE_KEY + ":logs", logs), [logs])
  useEffect(() => saveState(STORAGE_KEY + ":settings", settings), [settings])

  const model = useMemo(() => estimateDailySugarLimitG(onboarding, settings), [onboarding, settings])
  const dailyLimit = model.total

  const todayStart = startOfDay(new Date())
  const todayEnd = new Date(); todayEnd.setHours(23,59,59,999)
  const todaySugar = logs.filter(l => l.ts >= todayStart.getTime() && l.ts <= todayEnd.getTime()).reduce((a, b) => a + b.sugarG, 0)

  const [newItem, setNewItem] = useState("")
  const [newSugar, setNewSugar] = useState("")

  const addLog = () => {
    const grams = parseSugar(newSugar)
    if (!newItem || grams <= 0) return
    setLogs([{ id: uid(), ts: Date.now(), item: newItem, sugarG: grams, context: "Manual" }, ...logs])
    setNewItem("")
    setNewSugar("")
  }

  const removeLog = (id: string) => setLogs(logs.filter(l => l.id !== id))

  const resetAll = () => {
    if (!confirm("Reset all data?")) return
    setLogs([])
    setOnboarding({
      name: "",
      sex: "unspecified",
      age: 30,
      heightCm: 175,
      weightKg: 75,
      ethnicity: "prefer-not-to-say",
      activity: "moderate",
      consentAnalytics: false,
      useEthnicityAdjustment: false,
    })
    setConnections({ uberEats: false, banking: false, appleHealth: false })
  }

  const week = useMemo(() => last7DaysSeries(logs, dailyLimit), [logs, dailyLimit])
  const weekTotal = useMemo(() => week.reduce((a, b) => a + b.sugar, 0), [week])
  const weekTarget = dailyLimit * 7

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-900 p-6">
      <div className="max-w-5xl mx-auto grid gap-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">nosugar <span className="text-slate-500 text-base align-top">(know sugar)</span></h1>
            <p className="text-sm text-muted-foreground">AI-powered, preventive insights for added sugar — educational MVP demo.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetAll}>Reset</Button>
            <ExportButton onboarding={onboarding} connections={connections} logs={logs} />
          </div>
        </header>

        {/* Top Row: Profile + Budget */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 shadow-sm">
            <CardContent className="p-4">
              <SectionTitle icon={FileText} title="Profile" subtitle="Personalize your baseline" />
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input value={onboarding.name} onChange={e => setOnboarding({ ...onboarding, name: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Sex</label>
                  <Select value={onboarding.sex} onValueChange={(v: any) => setOnboarding({ ...onboarding, sex: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unspecified">Unspecified</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Age</label>
                  <Input type="number" min={5} max={100} value={onboarding.age} onChange={e => setOnboarding({ ...onboarding, age: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Height (cm)</label>
                  <Input type="number" min={100} max={230} value={onboarding.heightCm} onChange={e => setOnboarding({ ...onboarding, heightCm: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Weight (kg)</label>
                  <Input type="number" min={25} max={250} value={onboarding.weightKg} onChange={e => setOnboarding({ ...onboarding, weightKg: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">Activity level</label>
                  <Select value={onboarding.activity} onValueChange={(v: any) => setOnboarding({ ...onboarding, activity: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">Ethnicity (optional)</label>
                  <Input value={onboarding.ethnicity || ""} onChange={e => setOnboarding({ ...onboarding, ethnicity: e.target.value })} placeholder="Prefer not to say" />
                </div>
                <div className="col-span-2 flex items-center gap-2 mt-1">
                  <Checkbox checked={onboarding.consentAnalytics} onCheckedChange={(v: any) => setOnboarding({ ...onboarding, consentAnalytics: !!v })} />
                  <span className="text-xs text-muted-foreground">I consent to anonymous analytics for model improvement (demo)</span>
                </div>
                <div className="col-span-2 flex items-center gap-2 mt-1">
                  <Checkbox checked={!!onboarding.useEthnicityAdjustment} onCheckedChange={(v: any) => setOnboarding({ ...onboarding, useEthnicityAdjustment: !!v })} />
                  <span className="text-xs text-muted-foreground">Enable ethnicity-based adjustment (experimental)</span>
                </div>
              </div>
              <div className="mt-4 text-xs text-muted-foreground flex gap-2 items-start">
                <Info className="w-4 h-4 mt-0.5" />
                <span>
                  Disclaimer: This MVP provides educational estimates only, not medical advice. Ethnicity factor is experimental and optional to avoid biased assumptions.
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 shadow-sm">
            <CardContent className="p-4">
              <SectionTitle icon={FlameKindling} title="Today’s Budget" subtitle="Personalized daily added sugar estimate" />
              <div className="grid md:grid-cols-3 gap-4 items-start">
                <div className="md:col-span-2">
                  <div className="flex items-end gap-3">
                    <div className="text-5xl font-bold">{dailyLimit}</div>
                    <div className="pb-2 text-muted-foreground">g / day</div>
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

        {/* Settings */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <SectionTitle icon={SlidersHorizontal} title="Model settings" subtitle="Tune demo coefficients (instantly updates)" />
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

        {/* Middle Row: Manual log + Connections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <SectionTitle icon={Plus} title="Log sugar" subtitle="Add foods & drinks" />
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-3">
                  <Input placeholder="e.g., Iced latte" value={newItem} onChange={e => setNewItem(e.target.value)} />
                </div>
                <div className="col-span-1">
                  <Input placeholder="g" value={newSugar} onChange={e => setNewSugar(e.target.value)} />
                </div>
                <div className="col-span-1">
                  <Button className="w-full" onClick={addLog}>Add</Button>
                </div>
              </div>
              <div className="mt-4 max-h-64 overflow-auto divide-y">
                {logs.length === 0 && (
                  <div className="text-sm text-muted-foreground">No entries yet. Add your first item above.</div>
                )}
                {logs.map(l => (
                  <div key={l.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium">{l.item}</div>
                      <div className="text-xs text-muted-foreground">{l.sugarG} g • {new Date(l.ts).toLocaleTimeString()} • {l.context}</div>
                    </div>
                    <Button variant="ghost" onClick={() => removeLog(l.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-4">
              <SectionTitle icon={LinkIcon} title="Data sources" subtitle="Prototype connections (non-functional)" />
              <div className="grid grid-cols-1 gap-3">
                <ConnectTile
                  enabled={connections.uberEats}
                  onToggle={(v) => setConnections({ ...connections, uberEats: v })}
                  title="Uber Eats & grocery receipts"
                  subtitle="Parse order history for added sugar estimates"
                  icon={ShoppingCart}
                />
                <ConnectTile
                  enabled={connections.banking}
                  onToggle={(v) => setConnections({ ...connections, banking: v })}
                  title="Banking (read-only)"
                  subtitle="Infer food purchases via merchant codes"
                  icon={Banknote}
                />
                <ConnectTile
                  enabled={connections.appleHealth}
                  onToggle={(v) => setConnections({ ...connections, appleHealth: v })}
                  title="Apple Watch / Health"
                  subtitle="Use motion/meal timing for nudges"
                  icon={Watch}
                />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                In production, these would use OAuth (e.g., Uber, Plaid, Apple HealthKit) with strict privacy controls.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick presets & CSV import */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <SectionTitle icon={Plus} title="Speed add & import" subtitle="Quick presets or CSV upload" />
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-2">Quick presets</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p => (
                    <Button key={p.label} variant="outline" onClick={() => setQuickAdd(setLogs, p.label, p.grams)}>
                      {p.label} ({p.grams}g)
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Import CSV (columns: date,item,sugarG)</div>
                <ImportCsv onImport={(rows)=> addLogs(rows, setLogs)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Week View */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
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

        {/* Coaching */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <SectionTitle icon={Info} title="Coach (demo)" subtitle="Simple, rule-based suggestions" />
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-2 text-sm">
                {renderCoachTips(todaySugar, dailyLimit)}
              </div>
              <div className="space-y-2 text-sm">
                <div className="text-xs text-muted-foreground">Common items (approx. added sugar)</div>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Soda 12oz ≈ 39g</li>
                  <li>Sweetened yogurt (cup) ≈ 15–20g</li>
                  <li>Chocolate bar ≈ 24–30g</li>
                  <li>Sports drink 20oz ≈ 34g</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-xs text-muted-foreground text-center py-6">
          Built as a product exploration by Amith Wijesuriya & ChatGPT. Educational only — not medical advice.
        </footer>
      </div>
    </div>
  )
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
]

function addLogs(rows: { item: string, sugarG: number, ts?: number, context?: string }[], setLogs?: React.Dispatch<React.SetStateAction<LogEntry[]>>){
  const apply = setLogs || (globalThis as any).__setLogs
  if (!apply) return
  const mapped = rows.filter(r=> r.item && r.sugarG>0).map(r=> ({
    id: uid(),
    ts: r.ts || Date.now(),
    item: r.item,
    sugarG: Math.round(Number(r.sugarG)),
    context: r.context || "Import"
  }))
  apply(prev => [...mapped, ...prev])
}

function parseCsv(text: string){
  // Simple CSV parser for columns: date,item,sugarG (date optional)
  // Accepts ISO date (YYYY-MM-DD) or mm/dd/yyyy; falls back to now
  const lines = text.split(/\\r?\\n/).filter(l=> l.trim().length)
  if (!lines.length) return [] as { ts:number, item:string, sugarG:number }[]
  const header = lines[0].toLowerCase()
  const hasHeader = /(date|item|sugar)/.test(header)
  const rows = (hasHeader? lines.slice(1): lines)
  const out: { ts:number, item:string, sugarG:number }[] = []
  for (const line of rows){
    const cells = line.split(",")
    if (cells.length < 2) continue
    let dateStr = ""; let item = ""; let sugarStr = ""
    if (cells.length === 2){ item = cells[0]; sugarStr = cells[1] }
    else { dateStr = cells[0]; item = cells[1]; sugarStr = cells[2] }
    const ts = dateStr? Date.parse(dateStr) : Date.now()
    const sugarG = Number(String(sugarStr).replace(/[^0-9.]/g, ""))
    if (!item || !sugarG) continue
    out.push({ ts: isNaN(ts)? Date.now(): ts, item: item.trim(), sugarG: Math.round(sugarG) })
  }
  return out
}

function ImportCsv({ onImport }:{ onImport:(rows:{ item:string, sugarG:number, ts?:number }[])=>void }){
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="file" accept=".csv,text/csv" onChange={async (e)=>{
        const f = e.target.files?.[0]; if (!f) return
        const text = await f.text()
        const rows = parseCsv(text)
        onImport(rows)
        alert(`Imported ${rows.length} rows`) // demo UX
      }} />
      <span className="text-muted-foreground">Choose CSV…</span>
    </label>
  )
}

// ——————————————————————————————————————————————
// UI helpers
// ——————————————————————————————————————————————
function parseSugar(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? 0 : Math.round(n)
}

function setQuickAdd(setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>, label: string, grams: number) {
  setLogs(prev => [{ id: uid(), ts: Date.now(), item: label, sugarG: grams, context: "Quick" }, ...prev])
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
  )
}

function ExportButton({ onboarding, connections, logs }: { onboarding: Onboarding, connections: Connections, logs: LogEntry[] }) {
  const download = () => {
    const rollups = Array.from(rollupByDay(logs)).map(([day, sugar]) => ({ day, sugar }))
    const blob = new Blob([JSON.stringify({ onboarding, connections, logs, rollups }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `nosugar-export-${new Date().toISOString().slice(0,10)}.json`
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(url)
    a.remove()
  }
  return <Button variant="outline" onClick={download}>Export JSON</Button>
}

function ModelBreakdown({ model }: { model: { total: number, breakdown: Record<string, number> } }) {
  const b = model.breakdown as any
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
  )
}

function NumberField({ label, value, onChange }: { label: string, value: number, onChange: (v: number) => void }){
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input type="number" value={value} onChange={(e)=> onChange(Number(e.target.value))} />
    </label>
  )
}

function renderCoachTips(today: number, limit: number) {
  const pct = (today / limit) * 100
  const tips: string[] = []
  if (pct < 50) {
    tips.push("Nice pacing. Keep drinks sugar-free and save room for dinner.")
  } else if (pct < 80) {
    tips.push("You’re over halfway. Swap dessert for fruit or yogurt.")
  } else if (pct < 100) {
    tips.push("Close to your budget. Choose a savory snack or go for a short walk before eating.")
  } else {
    tips.push("You’re past today’s estimate. Hydrate and prioritize fiber/protein at your next meal.")
  }
  return (
    <ul className="list-disc ml-5 space-y-1">
      {tips.map((t, i) => <li key={i}>{t}</li>)}
      <li>Batch habits: pre-log known choices (e.g., latte), auto-skip sweet drinks.</li>
      <li>Week view idea: aim for consistency, not perfection. Occasional treats are okay in a balanced week.</li>
    </ul>
  )
}
