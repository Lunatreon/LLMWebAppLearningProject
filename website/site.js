const page = document.body.dataset.page || "";

const navigation = [
  ["home", "Home", "index.html"],
  ["courses", "Courses", "courses.html"],
  ["dream-builder", "Dream Builder", "dream-builder.html"],
  ["videos", "Videos", "videos.html"],
  ["toolkit", "Toolkit", "toolkit.html"],
  ["community", "Community", "community.html"],
  ["about", "About", "about.html"],
];

const header = document.querySelector("#site-header");
const footer = document.querySelector("#site-footer");

if (header) {
  header.className = "site-header";
  header.innerHTML = `
    <nav class="site-container site-nav" aria-label="Main navigation">
      <a class="site-brand" href="index.html" aria-label="FeelY home">
        <span class="site-brand-mark" aria-hidden="true">F</span>
        <span>FeelY</span>
      </a>
      <button id="menu-button" class="menu-button" type="button" aria-label="Open navigation" aria-expanded="false">&#9776;</button>
      <div id="nav-links" class="nav-links">
        ${navigation
          .map(
            ([id, label, href]) =>
              `<a class="${page === id ? "active" : ""}" href="${href}">${label}</a>`,
          )
          .join("")}
        <a class="nav-chat" href="chat.html">Open chat</a>
      </div>
    </nav>`;

  const menuButton = document.querySelector("#menu-button");
  const navLinks = document.querySelector("#nav-links");

  menuButton.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    menuButton.innerHTML = isOpen ? "&times;" : "&#9776;";
    document.body.classList.toggle("menu-open", isOpen);
  });

  navLinks.addEventListener("click", () => {
    navLinks.classList.remove("open");
    document.body.classList.remove("menu-open");
  });

  const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 12);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });
}

if (footer) {
  footer.className = "site-footer";
  footer.innerHTML = `
    <div class="site-container">
      <div class="footer-grid">
        <div class="footer-intro">
          <a class="site-brand" href="index.html"><span class="site-brand-mark" aria-hidden="true">F</span><span>FeelY</span></a>
          <p>Emotional clarity, practical reflection, and tools for becoming more fully yourself.</p>
        </div>
        <div class="footer-column">
          <strong>Explore</strong>
          <a href="courses.html">Courses</a>
          <a href="dream-builder.html">Dream Builder</a>
          <a href="videos.html">Videos</a>
          <a href="toolkit.html">Toolkit</a>
        </div>
        <div class="footer-column">
          <strong>Connect</strong>
          <a href="chat.html">Private chat</a>
          <a href="community.html">Community</a>
          <a href="about.html">About Lu</a>
          <a href="mailto:hello@feely.studio">Email FeelY</a>
        </div>
      </div>
      <div class="footer-bottom"><span>&copy; ${new Date().getFullYear()} FeelY</span><span>Become your own creation.</span></div>
    </div>`;
}

const quizQuestions = [
  {
    prompt: "What energy do you most need to cultivate right now?",
    options: [
      ["Soft body confidence", "Body Love"],
      ["Grounded leadership", "Become the Admired One"],
      ["Aligned love and partnership", "Relationship Alignment"],
      ["Steady execution", "Dream Achievement Method"],
    ],
  },
  {
    prompt: "What feels most in the way?",
    options: [
      ["My nervous system feels overwhelmed", "Make It Possible"],
      ["I cannot see the next step", "Self Assessment"],
      ["Relationship confusion", "Communication Mastery"],
      ["My beliefs about value and money", "Wealth Spotting"],
    ],
  },
  {
    prompt: "What kind of support would feel most useful?",
    options: [
      ["Self-paced rituals", "Body Love"],
      ["A clear personal framework", "Self Assessment"],
      ["Shared practice and accountability", "Become the Admired One"],
      ["Family-focused emotional tools", "Parenting Emotional Health"],
    ],
  },
];

const quiz = document.querySelector("#dream-builder");
if (quiz) {
  const content = document.querySelector("#quiz-content");
  const progressText = document.querySelector("#quiz-progress-text");
  const progressBar = document.querySelector("#quiz-progress-bar");
  let questionIndex = 0;
  let answers = [];

  function updateProgress() {
    const percent = Math.round((answers.length / quizQuestions.length) * 100);
    progressText.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  }

  function renderQuestion() {
    const question = quizQuestions[questionIndex];
    content.innerHTML = `
      <p class="quiz-question-number">Question ${questionIndex + 1} of ${quizQuestions.length}</p>
      <h2>${question.prompt}</h2>
      <div class="quiz-options">
        ${question.options
          .map(
            ([label, course], index) =>
              `<button class="quiz-option" type="button" data-answer="${index}" data-course="${course}">${label}</button>`,
          )
          .join("")}
      </div>`;

    content.querySelectorAll(".quiz-option").forEach((button) => {
      button.addEventListener("click", () => {
        answers.push(button.dataset.course);
        questionIndex += 1;
        updateProgress();
        if (questionIndex < quizQuestions.length) renderQuestion();
        else renderResults();
      });
    });
  }

  function renderResults() {
    const counts = answers.reduce((result, course) => {
      result[course] = (result[course] || 0) + 1;
      return result;
    }, {});
    const recommendations = [...new Set(answers)].sort((a, b) => counts[b] - counts[a]);
    content.innerHTML = `
      <p class="quiz-question-number">Your map</p>
      <h2>A useful place to begin.</h2>
      <div class="quiz-results-list">
        ${recommendations
          .map(
            (course, index) =>
              `<div class="quiz-result"><strong>${course}</strong><span>${index === 0 ? "Your strongest current signal" : "A supporting path"}</span></div>`,
          )
          .join("")}
      </div>
      <div class="quiz-actions">
        <a class="site-button site-button-dark" href="courses.html">Explore courses</a>
        <button id="quiz-reset" class="quiz-reset" type="button">Retake test</button>
      </div>`;
    document.querySelector("#quiz-reset").addEventListener("click", () => {
      answers = [];
      questionIndex = 0;
      updateProgress();
      renderQuestion();
    });
  }

  updateProgress();
  renderQuestion();
}

const filterButtons = document.querySelectorAll("[data-filter]");
if (filterButtons.length) {
  const cards = document.querySelectorAll(".video-card");
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const filter = button.dataset.filter;
      cards.forEach((card) => {
        card.classList.toggle("hidden", filter !== "all" && card.dataset.category !== filter);
      });
    });
  });
}

const previewDialog = document.querySelector("#preview-dialog");
if (previewDialog) {
  const previewTitle = document.querySelector("#preview-title");
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      previewTitle.textContent = button.dataset.preview;
      previewDialog.showModal();
    });
  });
  previewDialog.querySelector(".dialog-close").addEventListener("click", () => previewDialog.close());
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) previewDialog.close();
  });
}
