import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';
import yauzl from 'yauzl';

/** Analiza un `.feature` con el analizador oficial; lanza si no es Gherkin válido (SC-002). */
export function parseFeature(text: string): GherkinDocument {
  return new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher()).parse(
    text,
  );
}

/** Los archivos de un ZIP, por su ruta. */
export function unzip(body: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(body, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map<string, string>();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (failure, stream) => {
          if (failure) return reject(failure);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
