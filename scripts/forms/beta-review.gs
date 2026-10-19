/**
 * Job Triage — the beta review, as a Google Form.
 *
 * Google Apps Script, not part of the app. Run it signed in to the Google
 * account that should own the form, at https://script.google.com (the links
 * and the answers are mailed to NOTIFY whichever account runs it):
 *
 *   1. New project, paste this whole file over Code.gs, save.
 *   2. Pick `createBetaReview` in the function menu and press Run.
 *   3. Allow the permissions it asks for (Forms, Sheets, Gmail send, triggers).
 *
 * It makes the form, a response sheet linked to it, and a trigger that emails
 * every new response to NOTIFY; then it emails NOTIFY the three links (share,
 * edit, sheet).
 *
 * Safe to run again. The form's id is kept in the script's properties, so a
 * second run opens the same form (same link, same sheet) instead of making a
 * new one. While it has no responses, a rerun rebuilds the questions from this
 * file, so edits here reach the form; once anyone has answered, the questions
 * are left alone (rebuilding would scramble the sheet's columns) and the run
 * only re-sends the links. The response trigger is never added twice.
 */

const TITLE = 'Job Triage — Beta review';
const NOTIFY = 'support@jobtriage.in';   // the company mailbox: links and every response go here
const PROPS = PropertiesService.getScriptProperties();

function createBetaReview() {
  let form = null;
  const id = PROPS.getProperty('FORM_ID');
  if (id) { try { form = FormApp.openById(id); } catch (e) { form = null; } }   // deleted since: make a new one
  const fresh = !form;
  if (fresh) { form = FormApp.create(TITLE); PROPS.setProperty('FORM_ID', form.getId()); }

  if (!fresh && form.getResponses().length) {
    Logger.log(`The form already has ${form.getResponses().length} response(s); questions left as they are.`);
  } else {
    form.getItems().forEach(item => form.deleteItem(item));
    buildQuestions(form);
  }
  wireUp(form);
}

function buildQuestions(form) {
  form.setTitle(TITLE)
    .setDescription("You've used Job Triage during the beta. This is the last check before we change things. " +
      "There are no right answers: tell us what felt good, what got in the way, and what it's worth to you. About 5 minutes.")
    .setProgressBar(true)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setConfirmationMessage('Thank you. Every answer gets read.');

  // Helpers: one line per question, so the form reads like the draft.
  const one = (title, choices, opts = {}) => {
    const q = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(choices).setRequired(opts.required !== false);
    if (opts.other) q.showOtherOption(true);
    if (opts.help) q.setHelpText(opts.help);
    return q;
  };
  const many = (title, choices, opts = {}) => {
    const q = form.addCheckboxItem().setTitle(title).setChoiceValues(choices).setRequired(opts.required !== false);
    if (opts.max) q.setValidation(FormApp.createCheckboxValidation()
      .setHelpText(`Pick up to ${opts.max}.`).requireSelectAtMost(opts.max).build());
    if (opts.help) q.setHelpText(opts.help);
    return q;
  };
  const scale = (title, lo, hi, loLabel, hiLabel) =>
    form.addScaleItem().setTitle(title).setBounds(lo, hi).setLabels(loLabel, hiLabel).setRequired(true);
  const section = (title, help) => { const p = form.addPageBreakItem().setTitle(title); if (help) p.setHelpText(help); };

  // ── A. About you ──
  form.addSectionHeaderItem().setTitle('About you').setHelpText('So we can sort the answers.');
  one('What are you mainly looking for right now?',
    ['A full-time job', 'Contract or freelance work', 'A career change into a new field', "Just exploring / seeing what's out there"]);
  one('How much did you use Job Triage?',
    ['Opened it once or twice', 'A few times a week', 'Most days', 'I used it to actually apply for jobs']);

  // ── B. Must change ──
  section('Things that absolutely should change');
  many('What got in your way the most?', [
    'It was hard to understand what I was looking at at first',
    "The jobs shown didn't match what I want",
    'Too few jobs, especially near me',
    'Jobs were old or already closed',
    'Too many buttons and screens',
    'It was slow or something broke',
    "It didn't work well on my phone",
    "I didn't trust the scores",
    'Signing up or setting up my profile was a hassle',
    'Nothing got in my way'], { max: 3 });
  one('If we could fix only one thing, it should be:', [
    'Better job matches for me', 'More jobs, and fresher ones', 'Simpler to use',
    'Works better on the phone', 'Help with actually applying (CV, messages, contacts)'], { other: true });
  one('Was there a moment you almost gave up on the app?', [
    'No', 'Yes, while setting up my profile', 'Yes, the first time I saw the map',
    'Yes, while waiting for a search', "Yes, when the jobs didn't fit me"], { other: true });

  // ── C. Opinions and suggestions ──
  section('Opinions and suggestions');
  one('The map (jobs placed by fit and how reachable they are) was…', [
    'The best part, it showed me where to look', 'Interesting, but I preferred the list', 'Confusing', "I didn't really use it"]);
  one('The two scores, fit and reachability, were…', [
    'Accurate most of the time', 'Sometimes right, sometimes wrong', 'Mostly wrong for me', "I didn't look at them"]);
  many('What would make you come back every day?', [
    'A daily list of fresh jobs picked for me', 'Alerts when a company replies', 'Help writing applications and messages',
    'Knowing who to contact at a company', 'Seeing my progress (sent, replies, interviews)',
    "Companies to approach that aren't advertising", 'Advice on which direction suits me best'], { max: 3 });
  many('Where should we look for more work?', [
    'Government jobs', 'Startups', 'NGOs and the development sector', 'Freelance and remote work from abroad',
    'Local businesses near me', 'Big companies', 'Jobs from LinkedIn, WhatsApp or Telegram groups']);
  form.addParagraphTextItem().setTitle('Any suggestion, big or small?').setRequired(false);

  // ── D. Things you appreciate ──
  section('Things you appreciate');
  many('What did you like most?', [
    'It understood my CV and background', 'It told me honestly which jobs are a long shot',
    'The map, seeing everything in one place', 'It saved me hours of scrolling job boards',
    'The drafted messages and applications', 'Finding companies where I know someone',
    'The look and feel (colours, the drawings)', 'It felt calm, not like a typical job site'], { max: 3 });
  one('How did using it feel?', ['Calm and in control', 'Hopeful', 'Neutral, a tool like any other', 'Overwhelming', 'Discouraging']);
  scale('Taking in all that information (scores, map, lists) felt…', 1, 5, 'Too much, I felt lost', 'Clear, I knew what to do next');
  scale('How likely are you to recommend Job Triage to a friend who is job hunting?', 0, 10, 'Not at all', 'Definitely');

  // ── E. Pricing ──
  section('Pricing', 'Searching and the AI features cost us money on every use. We want a price that feels fair to you.');
  one('How would you prefer to pay?', [
    'Pay as I go: buy credits when I need them (how it works today)', 'A monthly subscription, unlimited use',
    'Pay only for one search or one application kit at a time', 'Pay only when I get a job (success fee)',
    'Free with ads', 'My college, employer or a job programme should pay', "I wouldn't pay for this"]);
  one('What is it worth to you per month?', ['₹0', 'Up to ₹99', '₹100–199', '₹200–499', '₹500–999', '₹1,000 or more']);
  one('Today ₹99 buys 100 credits (about 4 searches) and ₹399 buys 500. That feels…', [
    "Cheap, I'd pay more", 'About right', 'A bit expensive', 'Too expensive', "I don't understand what a credit gets me"]);
  many('Which would you actually pay for?', [
    'More and fresher jobs every day', 'A CV tailored to each job', 'Messages and applications written for me',
    'The right person to contact at a company', 'Reply tracking from my email',
    'A weekly plan: what to apply to and when', 'None of these']);
  one('How should we take payment?', ['UPI', 'Card', 'Net banking', 'PayPal or international card', "Doesn't matter"]);

  // ── Closing ── (last, so it does not colour the answers above)
  section('One last thing');
  one('Can we contact you for a 10-minute follow-up call?', ['Yes', 'No']);
  form.addTextItem().setTitle('If yes: your phone number or email').setRequired(false);
}

/* The response sheet, the per-response email and the links: each made once,
   found again on every later run. */
function wireUp(form) {
  let sheet = null;
  try { if (form.getDestinationId()) sheet = SpreadsheetApp.openById(form.getDestinationId()); } catch (e) { sheet = null; }
  if (!sheet) {
    sheet = SpreadsheetApp.create(TITLE + ' (responses)');
    form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  }
  const hasTrigger = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'emailResponse' && t.getTriggerSourceId() === form.getId());
  if (!hasTrigger) ScriptApp.newTrigger('emailResponse').forForm(form).onFormSubmit().create();

  const share = form.shortenFormUrl(form.getPublishedUrl());
  MailApp.sendEmail({
    to: NOTIFY,
    subject: TITLE + ' is ready',
    htmlBody: `<p>The beta review form is ready.</p>
      <p><b>Send this link to the testers:</b><br><a href="${share}">${share}</a></p>
      <p>Edit the form: <a href="${form.getEditUrl()}">${form.getEditUrl()}</a><br>
      Responses (sheet): <a href="${sheet.getUrl()}">${sheet.getUrl()}</a></p>
      <p>Every new response will also arrive here by email.</p>`,
  });
  Logger.log('Share: ' + share);
  Logger.log('Edit: ' + form.getEditUrl());
  Logger.log('Sheet: ' + sheet.getUrl());
}

/* Runs on every submission: the answers, as a plain list, to NOTIFY. */
function emailResponse(e) {
  // A tester's typed answer goes into an HTML mail, so it is escaped first.
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = e.response.getItemResponses().map(r => {
    const a = r.getResponse();
    return `<p><b>${esc(r.getItem().getTitle())}</b><br>${esc(Array.isArray(a) ? a.join(' · ') : a)}</p>`;
  }).join('');
  MailApp.sendEmail({
    to: NOTIFY,
    subject: 'New beta review response',
    htmlBody: rows || '<p>(an empty response)</p>',
  });
}
