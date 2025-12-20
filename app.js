// app.js — FINAL UI WIRING (Safari-safe, backend-aligned)

let resumes = [];
let jds = [];

const resumeInput = document.getElementById('resumeInput');
const jdInput = document.getElementById('jdInput');
const resumeBrowseBtn = document.getElementById('resumeBrowseBtn');
const jdBrowseBtn = document.getElementById('jdBrowseBtn');

const resumeFileList = document.getElementById('resumeFileList');
const jdFileList = document.getElementById('jdFileList');

const processBtn = document.getElementById('processBtn');
const clearBtn = document.getElementById('clearBtn');

const resultsSection = document.getElementById('resultsSection');
const resultsTableBody = document.getElementById('resultsTableBody');

const processingStatus = document.getElementById('processingStatus');
const statusText = document.getElementById('statusText');

/* ======================================================
   SAFARI: Explicit button → input wiring
   ====================================================== */

resumeBrowseBtn.addEventListener('click', () => resumeInput.click());
jdBrowseBtn.addEventListener('click', () => jdInput.click());

resumeInput.addEventListener('change', e => {
  resumes = Array.from(e.target.files);
  renderFileList(resumeFileList, resumes);
  updateProcessButton();
});

jdInput.addEventListener('change', e => {
  jds = Array.from(e.target.files);
  renderFileList(jdFileList, jds);
  updateProcessButton();
});

/* ======================================================
   UI HELPERS
   ====================================================== */

function renderFileList(container, files) {
  container.innerHTML = '';
  files.forEach(file => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = file.name;
    container.appendChild(div);
  });
}

function updateProcessButton() {
  processBtn.disabled = !(resumes.length && jds.length);
  processBtn.textContent = processBtn.disabled
    ? 'Upload Files to Start'
    : 'Start Matching';
  clearBtn.style.display = resumes.length || jds.length ? 'inline-block' : 'none';
}

/* ======================================================
   MAIN PROCESS
   ====================================================== */

processBtn.addEventListener('click', async () => {
  resultsTableBody.innerHTML = '';
  resultsSection.style.display = 'none';
  processingStatus.style.display = 'block';
  statusText.textContent = 'Matching resumes with job descriptions...';

  for (const resume of resumes) {
    for (const jd of jds) {
      try {
        const result = await matchResume(resume, jd);
        addResultRow(jd.name, result);
      } catch (err) {
        console.error('❌ Match error:', err.message);
      }
    }
  }

  processingStatus.style.display = 'none';
  resultsSection.style.display = 'block';
});

/* ======================================================
   BACKEND CALL
   ====================================================== */

async function matchResume(resumeFile, jdFile) {
  const formData = new FormData();
  formData.append('resume', resumeFile);
  formData.append('jd', jdFile);

  const res = await fetch('/api/match', {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  return await res.json();
}

/* ======================================================
   TABLE RENDERING (THIS WAS YOUR BUG)
   ====================================================== */

function addResultRow(jdName, data) {
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td>${data.candidate_name || '—'}</td>
    <td>${data.phone || '—'}</td>
    <td>${data.email || '—'}</td>
    <td>
      ${
        data.linkedin && data.linkedin !== '—'
          ? `<a href="${data.linkedin}" target="_blank">Profile</a>`
          : '—'
      }
    </td>
    <td>${jdName}</td>
    <td><strong>${data.match_score}%</strong></td>
  `;

  resultsTableBody.appendChild(tr);
}

/* ======================================================
   CLEAR
   ====================================================== */

clearBtn.addEventListener('click', () => {
  resumes = [];
  jds = [];
  resumeInput.value = '';
  jdInput.value = '';
  resumeFileList.innerHTML = '';
  jdFileList.innerHTML = '';
  resultsTableBody.innerHTML = '';
  resultsSection.style.display = 'none';
  updateProcessButton();
});
