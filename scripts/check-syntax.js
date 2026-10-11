import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

async function checkFile(filename) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filename], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Syntax check failed for ${filename}${signal ? ` (${signal})` : ""}.`));
    });
  });
}

const files = (await collectJavaScriptFiles("src")).sort();
for (const filename of files) await checkFile(filename);
