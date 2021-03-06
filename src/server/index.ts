import { program } from "commander";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import * as fs from "fs";
import prettier from "prettier";

type Update = [position: number, value: string];

const PROP_PLACEHOLDER = "css__";

function readFile(fileName: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    fs.readFile(fileName, { encoding: "utf8" }, (err, contents) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(contents);
    });
  });
}

function replacePlaceholder(
  contents: string,
  position: number,
  propValue: string,
  cssValue: string
): string {
  const isCssPlaceholderProp =
    contents.substring(position, position + PROP_PLACEHOLDER.length) ===
    PROP_PLACEHOLDER;
  if (isCssPlaceholderProp) {
    return `${contents.substring(0, position)}${propValue}${contents.substring(
      position + PROP_PLACEHOLDER.length
    )}`;
  }
  const nextCloseParen = contents.indexOf(")", position);
  return `${contents.substring(0, position)}${cssValue}${contents.substring(
    nextCloseParen + 1
  )}`;
}

async function processFile(
  fileName: string,
  updates: Array<Update>,
  options: {
    prettier: boolean;
  }
) {
  const contents = await readFile(fileName);
  let newContents = contents;
  let didAddCssCall = false;

  // Good ol' text manipulation here. We can process the AST using Babel but
  // it'll be harder to preserve formatting.
  updates
    .slice()
    // process updates from back to front
    .sort(([aPos], [bPos]) => bPos - aPos)
    .forEach(([position, value]) => {
      if (value.trim() === "") {
        newContents = replacePlaceholder(
          newContents,
          position,
          "",
          "undefined"
        );
        return;
      }
      newContents = replacePlaceholder(
        newContents,
        position,
        `css={css\`${value}\`}`,
        `css\`${value}\``
      );
      didAddCssCall = true;
    });

  if (didAddCssCall) {
    if (newContents.indexOf("@emotion/react") === -1) {
      newContents = `import {css} from '@emotion/react';\n${newContents}`;
    }
  }

  const formatted = options.prettier
    ? prettier.format(newContents, { filepath: fileName })
    : newContents;
  await new Promise<void>((resolve, reject) =>
    fs.writeFile(fileName, formatted, (err) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve();
    })
  );
}

function main() {
  program.option("-p, --port <port>", "server port", (p) => parseInt(p), 3199);
  program.option(
    "--no-prettier",
    "whether to format modified files with prettier"
  );
  program.parse(process.argv);

  const options = {
    prettier: program.prettier,
  };

  const app = express();
  app.use(bodyParser.json());
  app.use(cors());

  app.get("/ping", (_, res) => {
    res.send("pong");
  });

  app.post("/commit", async (req, res) => {
    const updates: Array<{
      fileName: string;
      position: number;
      value: string;
    }> = req.body.updates;
    const updatesByFile: Record<string, Array<Update>> = {};
    updates.forEach(({ fileName, position, value }) => {
      if (updatesByFile[fileName] === undefined) {
        updatesByFile[fileName] = [];
      }
      updatesByFile[fileName].push([position, value]);
    });
    try {
      await Promise.all(
        Object.keys(updatesByFile).map((fileName) => {
          try {
            processFile(fileName, updatesByFile[fileName], options);
            console.log(`modified file ${fileName}`);
          } catch (err) {
            console.log(`error updating file ${fileName}`, err);
          }
        })
      );
      res.sendStatus(200);
    } catch {
      res.sendStatus(400);
    }
  });

  app.listen(program.port);
  console.log(`manipulative server listening on port ${program.port}`);
  console.log(`options: ${JSON.stringify(options)}`);
}

main();
