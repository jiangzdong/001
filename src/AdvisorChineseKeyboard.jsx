import { useEffect, useMemo, useState } from "react";
import { ArrowBendDownLeft, ArrowUp, Backspace, CaretDown, Check, GlobeHemisphereWest } from "@phosphor-icons/react";
import { getAdvisorChineseCandidates, normalizeAdvisorPinyin } from "./advisorChineseIme.js";

const letterRows = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const numberRow = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const symbolRows = [
  ["-", "/", ":", ";", "(", ")", "¥", "@", "“", "”"],
  ["。", "，", "、", "？", "！", ".", ",", "'", "#", "%"],
];
let suppressCompatibilityClickUntil = 0;

function TouchButton({ className = "", label, onPress, children }) {
  return (
    <button
      className={className}
      type="button"
      onPointerDown={(event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen") event.preventDefault();
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        event.preventDefault();
        suppressCompatibilityClickUntil = performance.now() + 650;
        onPress?.(event);
      }}
      onClick={(event) => {
        // Chromium may emit a compatibility click after touch pointerup. The
        // pointerup already activated the key, so suppress only that duplicate.
        if (performance.now() < suppressCompatibilityClickUntil) return;
        onPress?.(event);
      }}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function TouchKey({ className = "", ...props }) {
  return <TouchButton className={`advisor-soft-key ${className}`} {...props} />;
}

export function AdvisorChineseKeyboard({ draft, open, onChange, onClose, onSubmit }) {
  const [composition, setComposition] = useState("");
  const [language, setLanguage] = useState("zh");
  const [numberMode, setNumberMode] = useState(false);
  const [shifted, setShifted] = useState(true);
  const candidates = useMemo(() => getAdvisorChineseCandidates(composition), [composition]);

  useEffect(() => {
    if (!open) setComposition("");
  }, [open]);

  if (!open) return null;

  const commit = (text) => {
    if (!text) return;
    onChange(`${draft}${text}`);
    setComposition("");
  };
  const backspace = () => {
    if (composition) setComposition((value) => value.slice(0, -1));
    else onChange(draft.slice(0, -1));
  };
  const insertDirect = (text) => {
    const pending = composition ? (candidates[0] || normalizeAdvisorPinyin(composition)) : "";
    onChange(`${draft}${pending}${text}`);
    setComposition("");
  };
  const toggleLanguage = () => {
    if (composition) commit(candidates[0] || normalizeAdvisorPinyin(composition));
    setLanguage((value) => value === "zh" ? "en" : "zh");
  };
  const pressLetter = (letter) => {
    if (language === "zh") setComposition((value) => normalizeAdvisorPinyin(`${value}${letter}`));
    else insertDirect(shifted ? letter.toUpperCase() : letter);
  };
  const send = () => {
    const pending = composition ? (candidates[0] || normalizeAdvisorPinyin(composition)) : "";
    const finalText = `${draft}${pending}`.trim();
    if (!finalText) return;
    setComposition("");
    onChange(finalText);
    onSubmit(finalText);
  };

  return (
    <section className="advisor-soft-keyboard" data-testid="advisor-soft-keyboard" aria-label="应用内中文拼音键盘">
      <div className="advisor-soft-keyboard__candidates" aria-label="中文候选词">
        <div>{language === "en" ? <span className="advisor-soft-keyboard__english-status">英文输入</span> : candidates.length ? candidates.map((candidate) => (
          <TouchButton key={candidate} onPress={() => commit(candidate)}>{candidate}</TouchButton>
        )) : <span className="advisor-soft-keyboard__english-status">请输入拼音</span>}</div>
        <TouchButton className="advisor-soft-keyboard__collapse" onPress={onClose} label="收起键盘并清空未发送内容"><CaretDown weight="bold" /></TouchButton>
      </div>
      <div className="advisor-soft-keyboard__rows">
        {numberMode ? <>
          <div className="advisor-soft-keyboard__row advisor-soft-keyboard__row--numbers" aria-label="数字键区">
            {numberRow.map((number) => <TouchKey key={number} className="is-number" label={`数字 ${number}`} onPress={() => insertDirect(number)}>{number}</TouchKey>)}
          </div>
          {symbolRows.map((row) => <div className="advisor-soft-keyboard__row" key={row.join("")}>
            {row.map((symbol) => <TouchKey key={symbol} label={`符号 ${symbol}`} onPress={() => insertDirect(symbol)}>{symbol}</TouchKey>)}
          </div>)}
        </> : <>
        {letterRows.slice(0, 2).map((row) => (
          <div className="advisor-soft-keyboard__row" key={row.join("")}>
            {row.map((letter) => <TouchKey key={letter} label={`${language === "zh" ? "拼音" : "英文"}字母 ${letter}`} onPress={() => pressLetter(letter)}>{shifted ? letter.toUpperCase() : letter}</TouchKey>)}
          </div>
        ))}
        <div className="advisor-soft-keyboard__row advisor-soft-keyboard__row--third">
          <TouchKey className={`is-modifier ${shifted ? "is-active" : ""}`} label="切换大小写" onPress={() => setShifted((value) => !value)}><ArrowUp weight="bold" /></TouchKey>
          {letterRows[2].map((letter) => <TouchKey key={letter} label={`${language === "zh" ? "拼音" : "英文"}字母 ${letter}`} onPress={() => pressLetter(letter)}>{shifted ? letter.toUpperCase() : letter}</TouchKey>)}
          <TouchKey className="is-modifier" label="退格" onPress={backspace}><Backspace weight="bold" /></TouchKey>
        </div>
        </>}
        <div className="advisor-soft-keyboard__row advisor-soft-keyboard__row--actions">
          <TouchKey className="is-mode" label={numberMode ? "返回字母键盘" : "切换数字符号键盘"} onPress={() => setNumberMode((value) => !value)}>{numberMode ? "ABC" : "123"}</TouchKey>
          <TouchKey className="is-language" label={`切换到${language === "zh" ? "英文" : "中文"}输入`} onPress={toggleLanguage}><GlobeHemisphereWest weight="bold" /><span>{language === "zh" ? "中" : "EN"}</span></TouchKey>
          <TouchKey className="is-punctuation" label="输入逗号" onPress={() => insertDirect(language === "zh" ? "，" : ",")}>，</TouchKey>
          <TouchKey className="is-space" label="空格或选择首个候选" onPress={() => language === "zh" && composition ? commit(candidates[0] || composition) : onChange(`${draft} `)}><span>空格</span></TouchKey>
          <TouchKey className="is-confirm" label="发送问题" onPress={send}><Check weight="bold" /><span>发送</span></TouchKey>
        </div>
      </div>
      <span className="advisor-sr-only"><ArrowBendDownLeft />中文候选上屏后，可点击发送问题</span>
    </section>
  );
}
