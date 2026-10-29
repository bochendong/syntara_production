import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HtdpLanguageLevel } from '@/lib/problem-bank/schema';

const MAX_OUTPUT_BYTES = 1024 * 1024;
// Loading the HtDP language and spd/tags takes ~0.3s; allow for a cold start.
const RACKET_STARTUP_MS = 15_000;
const RACKET_MAX_RUN_MS = 60_000;

export const DEFAULT_HTDP_LANGUAGE_LEVEL: HtdpLanguageLevel = 'intermediate-lambda';

/** The header DrRacket writes for a teaching-language file. */
export function htdpReaderHeader(level: HtdpLanguageLevel): string {
  return `#reader(lib "htdp-${level}-reader.ss" "lang")((modname submission) (read-case-sensitive #t) (teachpacks ()) (htdp-settings #(#t constructor repeating-decimal #f #t none #f () #f)))`;
}

const DRRACKET_METADATA_RE =
  /^;; The first three lines of this file were inserted by DrRacket\. They record metadata\n;; about the language level of this file in a form that our tools can easily process\.\n/gm;
const LANGUAGE_LINE_RE = /^[ \t]*#(?:reader|lang)\b.*$/gm;

/** Students, starters and support code may each carry their own DrRacket header.
 * Grading always uses the problem's configured level, so drop every header and
 * add exactly one. */
export function racketSubmissionSource(code: string, level: HtdpLanguageLevel): string {
  const body = code.replace(DRRACKET_METADATA_RE, '').replace(LANGUAGE_LINE_RE, '').trim();
  return `${htdpReaderHeader(level)}\n${body}\n`;
}

// Runs one submission in racket/sandbox: no network, no file access outside the
// installed collections, per-evaluation time and memory limits. Each case is a
// check-expect (JSON cases) or one top-level check-* form of a test suite.
export const RACKET_DRIVER = String.raw`
#lang racket/base
(require racket/sandbox racket/port racket/string racket/list racket/math json)

(define payload (call-with-input-file (vector-ref (current-command-line-arguments) 0) read-json))
(define (field k [default #f]) (hash-ref payload k default))

(define (emit v)
  (write-json v (current-output-port))
  (newline)
  (flush-output))

(define (exn->text e)
  (if (exn? e) (exn-message e) (format "~a" e)))

(define (read-all-forms str)
  ;; Read tests the way the teaching languages do: 7.99 is the exact number 799/100.
  (parameterize ([read-case-sensitive #t]
                 [read-decimal-as-inexact #f]
                 [read-accept-reader #f]
                 [read-accept-lang #f])
    (with-input-from-string str
      (lambda ()
        (let loop ([acc '()])
          (define form (read))
          (if (eof-object? form) (reverse acc) (loop (cons form acc))))))))

(define (read-one str)
  (define forms (read-all-forms str))
  (unless (= (length forms) 1)
    (error 'test "expected exactly one expression: ~a" str))
  (car forms))

(define secs (max 1 (/ (or (field 'timeoutMs) 5000) 1000.0)))
(define memory-mb (or (field 'memoryMb) 256))

(define module-output (open-output-string))
(define ev #f)
(define module-error #f)

(with-handlers ([(lambda (_) #t) (lambda (e) (set! module-error (exn->text e)))])
  (set! ev
        (parameterize ([sandbox-output module-output]
                       [sandbox-error-output module-output]
                       [sandbox-input #f]
                       [sandbox-gui-available #f]
                       [sandbox-memory-limit memory-mb]
                       [sandbox-eval-limits (list secs memory-mb)]
                       [sandbox-propagate-exceptions #t])
          (make-module-evaluator (string->path (field 'codePath))))))

(define (stdout-so-far)
  (define s (get-output-string module-output))
  (if (> (string-length s) 8000) (substring s 0 8000) s))

;; Format a value the way the HtDP languages print it (constructor style).
(define (show v)
  (with-handlers ([(lambda (_) #t) (lambda (_) (format "~v" v))])
    (call-in-sandbox-context
     ev
     (lambda ()
       (with-output-to-string (lambda () ((current-print) v)))))))

(define (trim-show v) (string-trim (show v)))

(define (within? a b delta)
  (cond [(and (real? a) (real? b)) (<= (magnitude (- a b)) delta)]
        [(and (pair? a) (pair? b)) (and (within? (car a) (car b) delta) (within? (cdr a) (cdr b) delta))]
        [(and (struct? a) (struct? b))
         (let ([va (struct->vector a)] [vb (struct->vector b)])
           (and (= (vector-length va) (vector-length vb))
                (for/and ([x va] [y vb]) (within? x y delta))))]
        [else (equal? a b)]))

;; The evaluator reads a string argument as program text, so a test whose value is a
;; string literal ("ce") would evaluate the identifier ce. Pass strings as an expression
;; that every HtDP level accepts (BSL's string-append needs at least two arguments).
(define (quote-strings d) (if (string? d) (list 'string-append d "") d))
(define (ev-datum d) (ev (quote-strings d)))

(define (run-check id description kind args)
  (define (result passed #:actual [actual #f] #:error [error #f])
    (for/fold ([h (hasheq 'id id 'passed passed)])
              ([k '(description actual error)] [v (list description actual error)])
      (if v (hash-set h k v) h)))
  (with-handlers ([(lambda (_) #t) (lambda (e) (result #f #:error (exn->text e)))])
    (case kind
      [(check-expect)
       (define actual (ev-datum (first args)))
       (define expected (ev-datum (second args)))
       (result (equal? actual expected) #:actual (trim-show actual))]
      [(check-within)
       (define actual (ev-datum (first args)))
       (define expected (ev-datum (second args)))
       (define delta (ev-datum (third args)))
       (result (within? actual expected delta) #:actual (trim-show actual))]
      [(check-error)
       (define raised
         (with-handlers ([exn:fail? (lambda (e) e)])
           (ev-datum (first args))
           #f))
       (cond
         [(not raised) (result #f #:error "expected an error, but none was raised")]
         [(and (= (length args) 2) (not (equal? (exn-message raised) (ev-datum (second args)))))
          (result #f #:actual (exn-message raised))]
         [else (result #t)])]
      [(check-satisfied)
       (define actual (ev-datum (first args)))
       ;; BSL only allows a function name in call position, so apply it in source form.
       (define ok (ev (list (second args) (quote-strings (first args)))))
       (result (and ok #t) #:actual (trim-show actual))]
      [else (result #f #:error (format "unsupported test form: ~a" kind))])))

(define check-forms '(check-expect check-within check-error check-satisfied))

;; A suite is plain HtDP test source: every top-level check-* form is one case.
(define (suite->cases text)
  (for/list ([form (read-all-forms text)] [i (in-naturals 1)])
    (define kind (and (pair? form) (car form)))
    (define source
      (let ([s (format "~s" form)]) (if (> (string-length s) 300) (string-append (substring s 0 297) "...") s)))
    (if (memq kind check-forms)
        (list (format "check_~a" i) source kind (cdr form))
        (list (format "check_~a" i) source 'invalid (list form)))))

(define (json-case->check c)
  (define id (hash-ref c 'id))
  (define description (hash-ref c 'description #f))
  (with-handlers ([(lambda (_) #t) (lambda (e) (list id description 'parse-error (list (exn->text e))))])
    (list id description 'check-expect
          (list (read-one (hash-ref c 'expression)) (read-one (hash-ref c 'expected))))))

;; Like DrRacket's Run: report the student's own top-level check-* forms.
(define (own-test-report)
  (define forms
    (with-handlers ([(lambda (_) #t) (lambda (_) '())])
      (let* ([text (call-with-input-file (field 'codePath) port->string)]
             [body (let ([nl (regexp-match-positions #rx"\n" text)])
                     (if nl (substring text (cdar nl)) text))])
        (filter (lambda (f) (and (pair? f) (memq (car f) check-forms))) (read-all-forms body)))))
  (cond
    [(null? forms) ""]
    [else
     (define failures
       (for/fold ([acc '()]) ([form forms] [i (in-naturals 1)])
         (define r (run-check (format "own_~a" i) #f (car form) (cdr form)))
         (if (hash-ref r 'passed)
             acc
             (cons (format "  ~a\n    ~a" (format "~s" form)
                           (cond [(hash-ref r 'error #f) => values]
                                 [(hash-ref r 'actual #f) => (lambda (a) (format "actual: ~a" a))]
                                 [else "failed"]))
                   acc))))
     (define n (length forms))
     (define k (length failures))
     (string-append
      (if (zero? k)
          (if (= n 1) "The test passed!\n" (format "All ~a tests passed!\n" n))
          (format "Ran ~a test~a.\n~a of the ~a test~a failed.\n\nCheck failures:\n~a\n"
                  n (if (= n 1) "" "s") k n (if (= n 1) "" "s")
                  (string-join (reverse failures) "\n"))))]))

(define (main)
  (cond
    [module-error
     (define cases
       (if (field 'testCode)
           (with-handlers ([(lambda (_) #t) (lambda (_) '())])
             (for/list ([c (suite->cases (field 'testCode))])
               (hasheq 'id (first c) 'description (second c) 'passed #f 'error module-error)))
           (for/list ([c (or (field 'testCases) '())])
             (hasheq 'id (hash-ref c 'id) 'passed #f 'error module-error))))
     (emit (hasheq 'cases cases 'moduleStdout (stdout-so-far) 'moduleError module-error))]
    [(equal? (field 'mode) "script")
     (define own (own-test-report))
     (emit (hasheq 'cases '() 'moduleStdout (string-append (stdout-so-far) own)))]
    [else
     (define checks
       (if (field 'testCode)
           (with-handlers ([(lambda (_) #t)
                            (lambda (e) (list (list "test_suite_error" #f 'parse-error (list (exn->text e)))))])
             (suite->cases (field 'testCode)))
           (map json-case->check (or (field 'testCases) '()))))
     (define cases
       (for/list ([c checks])
         (define-values (id description kind args) (apply values c))
         (case kind
           [(parse-error)
            (hasheq 'id id 'passed #f 'error (format "could not read test: ~a" (car args)))]
           [(invalid)
            (hasheq 'id id 'description description 'passed #f
                    'error "test suites may only contain check-expect, check-within, check-error or check-satisfied")]
           [else
            (define before (string-length (get-output-string module-output)))
            (define r (run-check id description kind args))
            (define printed (substring (get-output-string module-output) before))
            (if (string=? printed "") r (hash-set r 'stdout printed))])))
     (emit (hasheq 'cases cases 'moduleStdout (stdout-so-far)))]))

(main)
(when ev (kill-evaluator ev))
`.trim();

type RacketRunInput = {
  driverPath: string;
  payloadPath: string;
  timeoutMs: number;
  caseCount: number;
};

/**
 * Do not hand application credentials to student code: keep PATH, HOME and PLT*.
 * Racket rejects empty path variables (`bytes->path: byte string is empty`), so drop
 * them, and fall back to the build's add-on dir (nixpacks.toml installs spd into
 * ./.racket) when PLTADDONDIR is not set at runtime.
 */
function racketEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        Boolean(value?.trim()) && (key === 'PATH' || key === 'HOME' || key.startsWith('PLT')),
    ),
  ) as NodeJS.ProcessEnv;
  const buildAddonDir = path.join(process.cwd(), '.racket');
  if (!env.PLTADDONDIR && existsSync(buildAddonDir)) env.PLTADDONDIR = buildAddonDir;
  return env;
}

export function runRacketJson<T>(input: RacketRunInput): Promise<T> {
  // The driver limits every evaluation; this outer limit only catches a stuck process.
  const outerTimeout = Math.min(
    RACKET_MAX_RUN_MS,
    RACKET_STARTUP_MS + input.timeoutMs * (input.caseCount + 1),
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.env.RACKET_EXECUTABLE?.trim() || 'racket',
      [input.driverPath, input.payloadPath],
      {
        timeout: outerTimeout,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        env: racketEnv(),
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) reject(new Error('Racket runner timed out'));
          else if (error.code === 'ENOENT')
            reject(new Error('Racket is not installed on this server'));
          else reject(new Error(stderr || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new Error(stderr || 'Racket runner returned no result'));
        }
      },
    );
    child.stdin?.end();
  });
}
