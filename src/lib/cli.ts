import { createInterface } from "node:readline/promises";

export async function prompt(question: string) {
  const rl = createInterface(process.stdin, process.stdout);
  try {
    return await rl.question(question);
  } finally {
    // need to close readline otherwise it hangs
    rl.close();
  }
}

export async function confirm(question: string) {
  if (question.trimEnd() === question) {
    // if no whitespace in the end, add a space to separate answer
    question = question + " ";
  }
  for (;;) {
    const answer = await prompt(question);
    switch (answer.toLowerCase()) {
      case "y":
      case "yes":
        return true;
      case "n":
      case "no":
        return false;
      default:
        console.log(`Invalid answer: ${answer}, expecting (y/n/yes/no)`);
    }
  }
}
