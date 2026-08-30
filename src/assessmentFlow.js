export function advanceAssessment({ questions, questionIndex, answers, option }) {
  const question = questions[questionIndex];
  const canonicalOption = question?.options.find((item) => item.id === option?.id);
  if (!question || !canonicalOption) throw new Error("答案不属于当前题目");
  const nextAnswers = [...answers.filter((item) => item.id !== question.id), { id: question.id, answerId: canonicalOption.id, label: canonicalOption.label, score: canonicalOption.score }];
  const complete = questionIndex === questions.length - 1;
  return { answers: nextAnswers, questionIndex: complete ? questionIndex : questionIndex + 1, complete };
}
