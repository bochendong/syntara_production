/**
 * Design-recipe checks for HtDP (UBC CPSC 110 / spd) submissions, in the spirit of UBC's
 * spd-grader: compare the student's @signature, @template-origin, @dd-template-rules and
 * templates with the reference solution, check the student's own tests against the
 * reference function, and check the tests cover the cases the problem asks for.
 *
 * Expected answers come from the reference solution's tags, so a problem only stores the
 * solution file. Templates are compared only when the reference writes one: UBC asks for
 * @template and data-definition templates before Midterm 1, not after.
 */
export const RACKET_RECIPE_DRIVER = String.raw`
#lang racket/base
(require racket/sandbox racket/port racket/string racket/list json)

(define payload (call-with-input-file (vector-ref (current-command-line-arguments) 0) read-json))
(define (field k [default #f]) (hash-ref payload k default))
(define (exn->text e) (if (exn? e) (exn-message e) (format "~a" e)))
(define (show d) (let ([s (format "~s" d)]) (if (> (string-length s) 240) (string-append (substring s 0 237) "...") s)))

(define (read-forms str)
  (parameterize ([read-case-sensitive #t]
                 [read-decimal-as-inexact #f]
                 [read-accept-reader #f]
                 [read-accept-lang #f])
    (with-input-from-string str
      (lambda ()
        (let loop ([acc '()])
          (define form (read))
          (if (eof-object? form) (reverse acc) (loop (cons form acc))))))))

(define check-forms '(check-expect check-within check-error check-satisfied check-random check-member-of check-range))
(define (tag? form name) (and (pair? form) (eq? (car form) name)))
(define (function-define? form)
  (and (pair? form) (eq? (car form) 'define) (pair? (cdr form)) (pair? (cadr form)) (symbol? (caadr form))))

;; ---------------------------------------------------------------------------
;; Sections: every (@htdf f ...) / (@htdd T ...) owns the forms up to the next one.

(struct section (kind name forms) #:transparent)

(define (sections forms)
  ;; current = (kind names reversed-forms); (@htdf a b) designs two functions sharing the forms.
  (let loop ([forms forms] [current #f] [acc '()])
    (define (close)
      (if current
          (append (reverse (for/list ([n (second current)]) (section (first current) n (reverse (third current))))) acc)
          acc))
    (cond
      [(null? forms) (reverse (close))]
      [(or (tag? (car forms) '@htdf) (tag? (car forms) '@htdd))
       (define names (filter symbol? (cdar forms)))
       (loop (cdr forms)
             (and (pair? names) (list (if (tag? (car forms) '@htdf) 'htdf 'htdd) names '()))
             (close))]
      [current (loop (cdr forms) (list (first current) (second current) (cons (car forms) (third current))) acc)]
      [else (loop (cdr forms) #f acc)])))

(define (find-section secs kind name)
  (for/first ([s secs] #:when (and (eq? (section-kind s) kind) (equal? (section-name s) name))) s))

(define (tag-args s name)
  (for/first ([f (section-forms s)] #:when (tag? f name)) (cdr f)))

(define (template-defines s)
  (cond
    [(eq? (section-kind s) 'htdf)
     (define t (tag-args s '@template))
     (and t (pair? t) (andmap function-define? t) t)]
    [else
     ;; HtDD: the fn-for-... defines written after the data definition.
     (define ds (filter function-define? (section-forms s)))
     (and (pair? ds) ds)]))

;; ---------------------------------------------------------------------------
;; Template comparison: rename functions and parameters by position, treat
;; (... a b) as a bag of arguments, accept empty/'()/null spellings.

(define (normalize-template defines)
  (define fn-names (map caadr defines))
  (define fn-map (for/hash ([n fn-names] [i (in-naturals)]) (values n (string->symbol (format "fn~a" i)))))
  (for/list ([d defines])
    (define params (cdadr d))
    (define env (for/fold ([env fn-map]) ([p params] [i (in-naturals)])
                  (if (symbol? p) (hash-set env p (string->symbol (format "p~a" i))) env)))
    (list* 'define (cons (hash-ref fn-map (caadr d)) (map (lambda (p) (hash-ref env p p)) params))
          (norm (cddr d) env))))

(define (norm d env)
  (cond
    [(symbol? d)
     (case d
       [(null) 'empty]
       [(null?) 'empty?]
       [else (hash-ref env d d)])]
    [(equal? d '(quote ())) 'empty]
    [(and (pair? d) (eq? (car d) '...))
     (cons '... (sort (map (lambda (x) (norm x env)) (cdr d)) string<? #:key (lambda (x) (format "~s" x))))]
    [(pair? d) (cons (norm (car d) env) (norm (cdr d) env))]
    [(boolean? d) d]
    [else d]))

;; A bare ... body is the same as (...).
(define (unbare d)
  (cond [(eq? d '...) '(...)]
        [(and (pair? d) (eq? (car d) '...)) (cons '... (map unbare (cdr d)))]
        [(list? d) (map unbare d)]
        [else d]))

(define (cond-clauses body)
  (and (pair? body) (null? (cdr body)) (pair? (car body)) (eq? (caar body) 'cond) (cdar body)))

(define (explain-template-diff ref stu)
  (cond
    [(not (= (length ref) (length stu)))
     (format "expected ~a template function(s), found ~a" (length ref) (length stu))]
    [else
     (for/or ([r ref] [s stu] [i (in-naturals 1)])
       (define who (if (> (length ref) 1) (format "function ~a: " i) ""))
       (cond
         [(equal? r s) #f]
         [(not (= (length (cdadr r)) (length (cdadr s))))
          (format "~aexpected ~a parameter(s), found ~a" who (length (cdadr r)) (length (cdadr s)))]
         [else
          (define rc (cond-clauses (cddr r)))
          (define sc (cond-clauses (cddr s)))
          (cond
            [(and rc (not sc)) (format "~athe template should be a cond over the cases of the data" who)]
            [(and rc sc (not (= (length rc) (length sc))))
             (format "~aexpected ~a cond clauses, found ~a" who (length rc) (length sc))]
            [(and rc sc)
             (for/or ([rq rc] [sq sc] [j (in-naturals 1)])
               (cond
                 [(equal? rq sq) #f]
                 [(not (equal? (car rq) (car sq))) (format "~acond clause ~a: question does not match the data definition" who j)]
                 [else (format "~acond clause ~a: answer should reflect that case's selectors and natural recursion" who j)]))]
            [else (format "~athe template body does not match the template origin" who)])]))]))

;; ---------------------------------------------------------------------------
;; Evaluators

(define secs-limit (max 1 (/ (or (field 'timeoutMs) 5000) 1000.0)))
(define (make-ev path)
  (with-handlers ([(lambda (_) #t) (lambda (e) (exn->text e))])
    (parameterize ([sandbox-output (open-output-string)]
                   [sandbox-error-output (open-output-string)]
                   [sandbox-input #f]
                   [sandbox-gui-available #f]
                   [sandbox-memory-limit 256]
                   [sandbox-eval-limits (list secs-limit 256)]
                   [sandbox-propagate-exceptions #t])
      (make-module-evaluator (string->path path)))))

(define (quote-strings d) (if (string? d) (list 'string-append d "") d))

(define (test-valid? ev form)
  (with-handlers ([(lambda (_) #t) (lambda (_) #f)])
    (define args (cdr form))
    (case (car form)
      [(check-expect) (equal? (ev (quote-strings (first args))) (ev (quote-strings (second args))))]
      [(check-within)
       (let ([a (ev (quote-strings (first args)))] [b (ev (quote-strings (second args)))] [delta (ev (third args))])
         (or (equal? a b) (and (real? a) (real? b) (<= (abs (- a b)) delta))))]
      [(check-error)
       (with-handlers ([exn:fail? (lambda (_) #t)]) (ev (first args)) #f)]
      [else #t])))

(define (mentions? d name)
  (cond [(eq? d name) #t] [(pair? d) (or (mentions? (car d) name) (mentions? (cdr d) name))] [else #f]))

(define (subst d env)
  (cond [(and (symbol? d) (assq d env)) => cdr]
        [(pair? d) (cons (subst (car d) env) (subst (cdr d) env))]
        [else d]))

;; ---------------------------------------------------------------------------

(define (item id target passed [detail #f])
  (for/fold ([h (hasheq 'id id 'target (format "~a" target) 'passed passed)])
            ([k '(detail)] [v (list detail)])
    (if v (hash-set h k v) h)))

(define (bag-diff expected actual)
  ;; Multiset comparison: what is missing and what is extra.
  (define (remove-one x xs) (let loop ([xs xs]) (cond [(null? xs) '()] [(equal? (car xs) x) (cdr xs)] [else (cons (car xs) (loop (cdr xs)))])))
  (define missing (for/fold ([acc '()] [left actual] #:result (reverse acc)) ([x expected])
                    (if (member x left) (values acc (remove-one x left)) (values (cons x acc) left))))
  (define extra (for/fold ([left actual]) ([x expected]) (remove-one x left)))
  (values missing extra))

(define (bag-detail missing extra)
  (string-join
   (filter values
           (list (and (pair? missing) (format "missing: ~a" (string-join (map show missing) " ")))
                 (and (pair? extra) (format "should not include: ~a" (string-join (map show extra) " ")))))
   "; "))

(define (main)
  (define ref-forms (read-forms (field 'referenceText)))
  (define stu-forms
    (with-handlers ([(lambda (_) #t) (lambda (e) (exn->text e))]) (read-forms (field 'studentText))))
  (define check-template (field 'checkTemplate 'null))
  (define ref-secs (sections ref-forms))
  ;; Whatever the starter already gives (a data definition, a signature, the tests) is not
  ;; the student's work, so it is not graded.
  (define starter-forms
    (with-handlers ([(lambda (_) #t) (lambda (_) '())]) (read-forms (or (field 'starterText) ""))))
  (define starter-secs (sections starter-forms))
  (cond
    [(string? stu-forms)
     (write-json (hasheq 'items (list (item "read" "" #f (format "could not read the file: ~a" stu-forms)))))]
    [else
     (define stu-secs (sections stu-forms))
     (define ref-ev #f)
     (define (reference-ev)
       (unless ref-ev (set! ref-ev (make-ev (field 'referencePath))))
       ref-ev)
     (define thoroughness (or (field 'thoroughness) '()))
     (define items
       (append*
        (for/list ([rs ref-secs])
          (define name (section-name rs))
          (define kind (section-kind rs))
          (define ss (find-section stu-secs kind name))
          (define tag-name (if (eq? kind 'htdf) "@htdf" "@htdd"))
          (define gs (find-section starter-secs kind name))
          (define (given? tag) (and gs (equal? (tag-args gs tag) (tag-args rs tag))))
          (define (compare-bag id tag)
            (define expected (tag-args rs tag))
            (cond
              [(or (not expected) (given? tag)) '()]
              [(not ss) (list (item id name #f (format "missing (~a ~a)" tag-name name)))]
              [else
               (define actual (tag-args ss tag))
               (cond
                 [(not actual) (list (item id name #f (format "missing (~a ...)" tag)))]
                 [else
                  (define-values (missing extra)
                    (if (eq? tag '@template-origin)
                        (bag-diff (remove-duplicates expected) (remove-duplicates actual))
                        (bag-diff expected actual)))
                  (list (item id name (and (null? missing) (null? extra))
                              (and (or (pair? missing) (pair? extra)) (bag-detail missing extra))))])]))
          (define signature
            (let ([expected (tag-args rs '@signature)])
              (cond
                [(or (not expected) (given? '@signature)) '()]
                [(not ss) (list (item "signature" name #f (format "missing (~a ~a)" tag-name name)))]
                [else
                 (define actual (tag-args ss '@signature))
                 (list (item "signature" name (equal? expected actual)
                             (cond [(not actual) "missing (@signature ...)"]
                                   [(equal? expected actual) #f]
                                   [else (format "your signature ~a does not match the problem" (show (cons '@signature actual)))])))])))
          (define template
            (let ([expected (template-defines rs)])
              (cond
                [(or (not expected)
                     (eq? check-template #f)
                     (let ([g (and gs (template-defines gs))])
                       (and g (equal? (map unbare (normalize-template g)) (map unbare (normalize-template expected))))))
                 '()]
                [(not ss) (list (item "template" name #f (format "missing (~a ~a)" tag-name name)))]
                [else
                 (define actual (template-defines ss))
                 (cond
                   [(not actual)
                    (list (item "template" name #f
                                (if (eq? kind 'htdf) "missing (@template (define ...))" "missing the fn-for-... template")))]
                   [else
                    (define r (map unbare (normalize-template expected)))
                    (define s (map unbare (normalize-template actual)))
                    (list (item "template" name (equal? r s) (and (not (equal? r s)) (explain-template-diff r s))))])])))
          (define (tests-for name forms)
            (filter (lambda (f) (and (pair? f) (memq (car f) check-forms) (mentions? f name))) forms))
          (define ref-tests (tests-for name ref-forms))
          (define tests-given? (andmap (lambda (t) (member t starter-forms)) ref-tests))
          (define tests
            (cond
              ;; No reference tests (e.g. a big-bang main) or the starter supplies them all.
              [(or (not (eq? kind 'htdf)) (null? ref-tests) tests-given?) '()]
              [else
               (define own* (if ss (tests-for name stu-forms) '()))
               (define validity
                 (cond
                   [(null? own*) (item "test_validity" name #f (format "write check-expect tests for ~a" name))]
                   [else
                    (define ev (reference-ev))
                    (cond
                      [(string? ev) (item "test_validity" name #f (format "reference solution failed to load: ~a" ev))]
                      [else
                       (define bad (filter (lambda (f) (not (test-valid? ev f))) own*))
                       (item "test_validity" name (null? bad)
                             (and (pair? bad)
                                  (format "~a of ~a test(s) disagree with a correct ~a: ~a"
                                          (length bad) (length own*) name (string-join (map show (take bad (min 3 (length bad)))) " "))))])]))
               (define wanted (filter (lambda (t) (equal? (hash-ref t 'target #f) (symbol->string name))) thoroughness))
               (define coverage
                 (cond
                   [(null? wanted) '()]
                   [else
                    (define ev (reference-ev))
                    (define ref-define
                      (for/first ([f ref-forms] #:when (and (function-define? f) (eq? (caadr f) name))) f))
                    (define params (if ref-define (cdadr ref-define) '()))
                    (define calls
                      (for*/list ([f own*]
                                  #:when (and (pair? (cdr f)) (pair? (cadr f)) (eq? (car (cadr f)) name)
                                              (= (length (cdr (cadr f))) (length params))))
                        (cdr (cadr f))))
                    (define uncovered
                      (for/list ([t wanted]
                                 #:unless
                                 (and (not (string? ev))
                                      (for/or ([args calls])
                                        (with-handlers ([(lambda (_) #t) (lambda (_) #f)])
                                          (define pred (car (read-forms (hash-ref t 'predicate))))
                                          (ev (subst pred (map cons params args)))))))
                        (hash-ref t 'description)))
                    (list (item "test_thoroughness" name (null? uncovered)
                                (and (pair? uncovered) (format "no test covers: ~a" (string-join uncovered "; ")))))]))
               (cons validity coverage)]))
          (append signature
                  (compare-bag "template_origin" '@template-origin)
                  (compare-bag "dd_template_rules" '@dd-template-rules)
                  template
                  tests))))
     (when (and ref-ev (not (string? ref-ev))) (kill-evaluator ref-ev))
     (write-json (hasheq 'items items))]))

(main)
`.trim();

// ---------------------------------------------------------------------------
// Stub and purpose live in comments, which the driver's reader drops, so they are
// checked on the source text. Like the Python driver, each is required for every
// function the reference designs with @htdf, unless the reference has none or the
// starter already gives it (a stub only when the starter has it commented out).

type RecipeCommentCheck = {
  id: 'stub' | 'purpose';
  target: string;
  passed: boolean;
  detail?: string;
};

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** name -> the source text from its (@htdf ...) up to the next @htdf / @htdd / @problem. */
function htdfSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const starts = [...text.matchAll(/^[ \t]*\(@(htdf|htdd|problem)\b([^)]*)\)/gm)];
  starts.forEach((match, index) => {
    if (match[1] !== 'htdf') return;
    const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const section = text.slice(match.index, end);
    for (const name of match[2].trim().split(/\s+/).filter(Boolean)) sections.set(name, section);
  });
  return sections;
}

/** Parameter count of `(define (name a b ...)` in code, or null when there is none. */
function defineArity(code: string, name: string): number | null {
  const header = code.match(
    new RegExp(`\\(define\\s*[([]\\s*${escapeName(name)}((?:\\s+[^\\s()[\\]]+)*)\\s*[)\\]]`),
  );
  return header ? header[1].trim().split(/\s+/).filter(Boolean).length : null;
}

/** Commented-out defines of name: `;(define (f x) 0) ; stub`, `#;(define ...)` or inside `#| |#`. */
function commentedDefines(section: string, name: string): string[] {
  const found: string[] = [];
  const head = `\\(define\\s*[([]\\s*${escapeName(name)}[\\s)\\]]`;
  for (const match of section.matchAll(new RegExp(`^[ \\t]*;+[ \\t]*(${head}.*)$`, 'gm')))
    found.push(match[1]);
  for (const match of section.matchAll(new RegExp(`#;\\s*(${head}[^\\n]*)`, 'g')))
    found.push(match[1]);
  for (const block of section.matchAll(/#\|([\s\S]*?)\|#/g)) {
    for (const match of block[1].matchAll(new RegExp(`(${head}[^\\n]*)`, 'g')))
      found.push(match[1]);
  }
  return found;
}

function hasStub(section: string, name: string, arity: number | null): boolean {
  return commentedDefines(section, name).some(
    (define) => arity === null || defineArity(define, name) === arity,
  );
}

/** A `;` comment with words after the @signature (not commented-out code). */
function hasPurpose(section: string): boolean {
  const signature = section.search(/\(@signature\b/);
  const lines = section.slice(Math.max(signature, 0)).split('\n');
  return lines.some((line) => {
    const comment = line.match(/^[ \t]*;+[ \t]*(.*)$/)?.[1].trim() ?? '';
    return !comment.startsWith('(') && /[A-Za-z]{2,}\W+[A-Za-z]{2,}/.test(comment);
  });
}

export function racketStubAndPurposeChecks(args: {
  studentText: string;
  referenceText: string;
  starterText?: string;
}): RecipeCommentCheck[] {
  const reference = htdfSections(args.referenceText);
  const starter = htdfSections(args.starterText ?? '');
  const student = htdfSections(args.studentText);
  const items: RecipeCommentCheck[] = [];
  for (const [name, refSection] of reference) {
    const arity = defineArity(args.referenceText.replace(/^[ \t]*;.*$/gm, ''), name);
    const given = starter.get(name) ?? '';
    const mine = student.get(name);
    // Only a starter whose stub is already commented out gives it. A live starter stub
    // (`(define (f n) 0) ;stub`) still has to be commented out by the student.
    const stubGiven = hasStub(given, name, arity) || hasStub(args.starterText ?? '', name, arity);
    if (hasStub(refSection, name, arity) && !stubGiven) {
      items.push(
        mine === undefined
          ? { id: 'stub', target: name, passed: false, detail: `missing (@htdf ${name})` }
          : hasStub(mine, name, arity)
            ? { id: 'stub', target: name, passed: true }
            : {
                id: 'stub',
                target: name,
                passed: false,
                detail: `keep the stub as a comment, e.g. ;(define (${name}${' x'.repeat(arity ?? 1)}) ...) ; stub`,
              },
      );
    }
    if (hasPurpose(refSection) && !hasPurpose(given)) {
      items.push(
        mine === undefined
          ? { id: 'purpose', target: name, passed: false, detail: `missing (@htdf ${name})` }
          : hasPurpose(mine)
            ? { id: 'purpose', target: name, passed: true }
            : {
                id: 'purpose',
                target: name,
                passed: false,
                detail: `write a purpose comment after the @signature of ${name}`,
              },
      );
    }
  }
  return items;
}
