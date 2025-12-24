// app.js — UPDATED UI WITH CORRECTED TABLE COLUMN ORDER

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
FILE INPUT HANDLING 
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
  processBtn.textContent = processBtn.disabled ? 'Upload Files to Start' : 'Start Matching';
  clearBtn.style.display = resumes.length || jds.length ? 'inline-block' : 'none';
}

/* ====================================================== 
BATCH PROCESSING
====================================================== */

processBtn.addEventListener('click', async () => {
  resultsTableBody.innerHTML = '';
  resultsSection.style.display = 'none';
  processingStatus.style.display = 'block';

  try {
    // Process each JD with all resumes
    for (const jd of jds) {
      statusText.textContent = `Processing "${jd.name}" with ${resumes.length} resumes...`;
      await processBatch(resumes, jd);
    }

    processingStatus.style.display = 'none';
    resultsSection.style.display = 'block';
  } catch (err) {
    console.error('❌ Batch processing error:', err.message);
    statusText.textContent = '❌ Error during processing';
  }
});

/* ====================================================== 
BATCH API CALL (RANKS ALL CVs TOGETHER)
====================================================== */

async function processBatch(resumeFiles, jdFile) {
  const formData = new FormData();

  // Add all resumes
  resumeFiles.forEach(file => {
    formData.append('resumes', file);
  });

  // Add single JD
  formData.append('jd', jdFile);

  const res = await fetch('/api/batch-match', {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  const data = await res.json();
  
  // Add all results (already ranked by backend)
  data.ranked_results.forEach(result => {
    addResultRow(jdFile.name, result);
  });
}

/* ====================================================== 
TABLE RENDERING (CORRECTED COLUMN ORDER)
====================================================== */

function addResultRow(jdName, data) {
  const tr = document.createElement('tr');
  
  // Color code by score
  let scoreClass = '';
  if (data.match_score >= 75) scoreClass = 'score-high';
  else if (data.match_score >= 50) scoreClass = 'score-medium';
  else scoreClass = 'score-low';

  // TABLE COLUMN ORDER:
  // 1. Candidate Name
  // 2. Resume File Name
  // 3. Job Description
  // 4. Match Score
  // 5. Seniority Fit
  // 6. Email
  // 7. Contact Number
  // 8. LinkedIn Profile
  // 9. Match Summary

  tr.innerHTML = `
    <td><strong>${data.candidate_name}</strong></td>
    <td>${data.resume_name}</td>
    <td>${jdName}</td>
    <td class="${scoreClass}"><strong>${data.match_score}%</strong></td>
    <td>${data.seniority_fit}</td>
    <td>${data.email}</td>
    <td>${data.phone}</td>
    <td><a href="${data.linkedin}" target="_blank" rel="noopener noreferrer">${data.linkedin === '—' ? '—' : 'View'}</a></td>
    <td class="summary-cell">${data.summary}</td>
  `;

  resultsTableBody.appendChild(tr);
}

/* ====================================================== 
CLEAR FUNCTION 
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
  processingStatus.style.display = 'none';
  updateProcessButton();
});