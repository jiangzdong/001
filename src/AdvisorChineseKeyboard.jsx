import { useEffect, useMemo, useState } from "react";
import { ArrowBendDownLeft, Backspace, Check, X } from "@phosphor-icons/react";
import { getAdvisorChineseCandidates, normalizeAdvisorPinyin } from "./advisorChineseIme.js";

const letterRows = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const numberRow = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
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

  return (
    <section className="advisor-soft-keyboard" data-testid="advisor-soft-keyboard" aria-label="应用内中文拼音键盘">
      <div className="advisor-soft-keyboard__topline">
        <TouchButton className="advisor-soft-keyboard__language" onPress={toggleLanguage} label={`切换到${language === "zh" ? "英文" : "中文"}输入`}>
          <strong className={language === "zh" ? "is-active" : ""}>中</strong>
          <i aria-hidden="true" />
          <strong className={language === "en" ? "is-active" : ""}>EN</strong>
        </TouchButton>
        <TouchButton onPress={onClose} label="收起中文键盘"><X weight="bold" /></TouchButton>
      </div>
      <div className="advisor-soft-keyboard__candidates" aria-label="中文候选词">
        {language === "en" ? <span className="advisor-soft-keyboard__english-status">英文输入</span> : candidates.length ? candidates.map((candidate) => (
          <TouchButton key={candidate} onPress={() => commit(candidate)}>{candidate}</TouchButton>
        )) : <TouchButton onPress={() => commit(normalizeAdvisorPinyin(composition))}>输入“{composition}”</TouchButton>}
      </div>
      <div className="advisor-soft-keyboard__rows">
        <div className="advisor-soft-keyboard__row advisor-soft-keyboard__row--numbers" aria-label="数字键区">
          {numberRow.map((number) => <TouchKey key={number} className="is-number" label={`数字 ${number}`} onPress={() => insertDirect(number)}>{number}</TouchKey>)}
        </div>
        {letterRows.map((row) => (
          <div className="advisor-soft-keyboard__row" key={row.join("")}>
            {row.map((letter) => <TouchKey key={letter} label={`${language === "zh" ? "拼音" : "英文"}字母 ${letter}`} onPress={() => language === "zh" ? setComposition((value) => normalizeAdvisorPinyin(`${value}${letter}`)) : insertDirect(letter)}>{letter}</TouchKey>)}
          </div>
        ))}
        <div className="advisor-soft-keyboard__row advisor-soft-keyboard__row--actions">
          <TouchKey className="is-secondary" label="退格" onPress={backspace}><Backspace weight="bold" /><span>退格</span></TouchKey>
          <TouchKey className="is-space" label="空格或选择首个候选" onPress={() => language === "zh" && composition ? commit(candidates[0] || composition) : onChange(`${draft} `)}><span>空格</span></TouchKey>
          <TouchKey className="is-punctuation" label="输入问号" onPress={() => commit("？")}>？</TouchKey>
          <TouchKey className="is-confirm" label="发送问题" onPress={onSubmit}><Check weight="bold" /><span>发送</span></TouchKey>
        </div>
      </div>
      <span className="advisor-sr-only"><ArrowBendDownLeft />中文候选上屏后，可点击发送问题</span>
    </section>
  );
}
