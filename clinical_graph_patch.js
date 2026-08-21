function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  if (matches.length !== 1) {
    throw new Error(`${label} 패치 지점 수 불일치: ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

// 난독화된 운영 index의 그래프 함수만 좁게 변환한다. 패턴이 달라지면 조용히
// 잘못 고치는 대신 즉시 실패시켜 배포 검증이 회귀를 잡도록 한다.
export function patchClinicalGraphSource(functionSource) {
  let source = String(functionSource || "");
  const plotPattern = /function\s+([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{const\s+[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*;if\(([A-Za-z_$][\w$]*)\)return\s+Math\[[^\]]+\]\(0x1,\2\/\(\3\|\|0x1\)\);return\s+\2\/([A-Za-z_$][\w$]*);\}/;
  const plotMatch = source.match(plotPattern);
  if (!plotMatch) throw new Error("100% 고정축 plotRatio 패턴을 찾지 못했습니다.");

  const [, plotFunction, valueVar, referenceVar, normalizeVar, globalMaxVar] = plotMatch;
  const curvesPattern = new RegExp(
    `const\\s+${escapeRegExp(normalizeVar)}=([A-Za-z_$][\\w$]*)\\[[^\\]]+\\]>0x1;`,
  );
  const curvesMatch = source.match(curvesPattern);
  if (!curvesMatch) throw new Error("다약제 곡선 배열 패턴을 찾지 못했습니다.");
  const curvesVar = curvesMatch[1];

  const plotReplacement =
    `const __jwbsAxisMaxPercent=${normalizeVar}`
    + `?clinicalGraphScale.axisMaxPercentFromCurves(${curvesVar}):100;`
    + `function ${plotFunction}(${valueVar},${referenceVar}){`
    + `if(${normalizeVar})return clinicalGraphScale.plotRatio(${valueVar},${referenceVar},__jwbsAxisMaxPercent);`
    + `return ${valueVar}/${globalMaxVar};}`;
  source = source.replace(plotPattern, plotReplacement);

  const axisLabelPattern = new RegExp(
    `(const\\s+[A-Za-z_$][\\w$]*=)${escapeRegExp(normalizeVar)}`
      + `\\?([A-Za-z_$][\\w$]*)\\*0x19\\+'%'(:\\([^;]+;)`,
  );
  source = replaceExactlyOnce(
    source,
    axisLabelPattern,
    `$1${normalizeVar}?clinicalGraphScale.axisTickPercent($2,4,__jwbsAxisMaxPercent)+'%'$3`,
    "동적 Y축 레이블",
  );

  const ratioAssignments = [...source.matchAll(
    new RegExp(
      `([A-Za-z_$][\\w$]*)=${escapeRegExp(plotFunction)}\\(`
        + `([A-Za-z_$][\\w$]*),([A-Za-z_$][\\w$]*)\\)`,
      "g",
    ),
  )];
  let percentReplacementCount = 0;
  for (const [, ratioVar, rawValueVar, rawReferenceVar] of ratioAssignments) {
    const displayedPercentPattern = new RegExp(
      `\\(${escapeRegExp(ratioVar)}\\*0x64\\)\\[[^\\]]+\\]\\(0x1\\)`,
      "g",
    );
    const before = source;
    source = source.replace(
      displayedPercentPattern,
      `clinicalGraphScale.formatResidualPercent(${rawValueVar},${rawReferenceVar})`,
    );
    if (source !== before) percentReplacementCount += 1;
  }
  if (percentReplacementCount !== 2) {
    throw new Error(`현재값/툴팁 원시 % 패치 지점 수 불일치: ${percentReplacementCount}`);
  }

  if (/return\s+Math\[[^\]]+\]\(0x1,[^;]+\);/.test(source)) {
    throw new Error("100% 절단식이 패치 뒤에도 남았습니다.");
  }
  return source;
}
