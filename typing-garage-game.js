const LEVELS = [
  {
    id: "r8",
    code: "R8",
    name: "R8",
    maker: "AUDI",
    color: "#d9362f",
    accent: "#ffd84a",
    scene: "night",
    imageUrl: "assets/typing-garage/r8.jpg"
  },
  {
    id: "m3",
    code: "M3",
    name: "M3",
    maker: "BMW",
    color: "#1683d8",
    accent: "#f5f7fb",
    scene: "studio",
    imageUrl: "assets/typing-garage/m3.jpg"
  },
  {
    id: "nine-eleven",
    code: "911",
    name: "911",
    maker: "PORSCHE",
    color: "#f0b51c",
    accent: "#1f2933",
    scene: "sunset",
    imageUrl: "assets/typing-garage/nine-eleven.jpg"
  },
  {
    id: "gtr",
    code: "GTR",
    name: "GTR",
    maker: "NISSAN",
    color: "#a7b0bb",
    accent: "#e33a2d",
    scene: "track",
    imageUrl: "assets/typing-garage/gtr.jpg"
  },
  {
    id: "bmw",
    code: "BMW",
    name: "BMW",
    maker: "BMW",
    color: "#f8fafc",
    accent: "#2383d8",
    scene: "studio",
    imageUrl: "assets/typing-garage/bmw.jpg"
  },
  {
    id: "audi",
    code: "AUDI",
    name: "AUDI",
    maker: "AUDI",
    color: "#222831",
    accent: "#d9e3ee",
    scene: "night",
    imageUrl: "assets/typing-garage/audi.jpg"
  },
  {
    id: "byd",
    code: "BYD",
    name: "BYD",
    maker: "BYD",
    color: "#1e9f70",
    accent: "#e6fff5",
    scene: "city",
    imageUrl: "assets/typing-garage/byd.jpg"
  },
  {
    id: "kia",
    code: "KIA",
    name: "KIA",
    maker: "KIA",
    color: "#8a2be2",
    accent: "#fbf5ff",
    scene: "studio",
    imageUrl: "assets/typing-garage/kia.jpg"
  },
  {
    id: "car",
    code: "CAR",
    name: "CAR",
    maker: "SUPER",
    color: "#ef4444",
    accent: "#fef08a",
    scene: "track",
    imageUrl: "assets/typing-garage/car.jpg"
  },
  {
    id: "fast",
    code: "FAST",
    name: "FAST",
    maker: "TURBO",
    color: "#f97316",
    accent: "#ecfeff",
    scene: "sunset",
    imageUrl: "assets/typing-garage/fast.jpg"
  }
];

const COMPLETE_MESSAGES = [
  "解锁完成！",
  "车库 +1！",
  "漂亮！",
  "发动机启动！"
];

const KEYBOARD_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"]
];

export function createTypingGarageGame() {
  const stage = document.getElementById("typingGarageStage");
  const photo = document.getElementById("typingGaragePhoto");
  const cover = document.getElementById("typingGarageCover");
  const flash = document.getElementById("typingGarageFlash");
  const badge = document.getElementById("typingGarageBadge");
  const target = document.getElementById("typingGarageTarget");
  const progress = document.getElementById("typingGarageProgress");
  const nextKey = document.getElementById("typingGarageNextKey");
  const message = document.getElementById("typingGarageMessage");
  const cards = document.getElementById("typingGarageCards");
  const count = document.getElementById("typingGarageCount");
  const keyboard = document.getElementById("typingGarageKeyboard");
  const libraryButton = document.getElementById("typingGarageLibraryButton");
  const libraryBackdrop = document.getElementById("typingGarageLibraryBackdrop");
  const libraryCloseButton = document.getElementById("typingGarageLibraryCloseButton");
  const libraryPanel = document.querySelector(".typing-garage-sidebar");
  const nextButton = document.getElementById("typingGarageNextButton");
  const replayButton = document.getElementById("typingGarageReplayButton");
  const resetButton = document.getElementById("typingGarageResetButton");

  let currentIndex = 0;
  let typed = "";
  let unlocked = new Set();
  let isActive = false;
  let messageIndex = 0;

  function start() {
    if (isActive) return;
    isActive = true;
    renderKeyboard();
    window.addEventListener("keydown", handleKeydown);
    keyboard.addEventListener("pointerdown", handleKeyboardPointer);
    libraryButton.addEventListener("click", openLibrary);
    libraryBackdrop.addEventListener("click", closeLibrary);
    libraryCloseButton.addEventListener("click", closeLibrary);
    nextButton.addEventListener("click", goNext);
    replayButton.addEventListener("click", replayCurrent);
    resetButton.addEventListener("click", resetCollection);
    render();
  }

  function stop() {
    if (!isActive) return;
    isActive = false;
    window.removeEventListener("keydown", handleKeydown);
    keyboard.removeEventListener("pointerdown", handleKeyboardPointer);
    libraryButton.removeEventListener("click", openLibrary);
    libraryBackdrop.removeEventListener("click", closeLibrary);
    libraryCloseButton.removeEventListener("click", closeLibrary);
    nextButton.removeEventListener("click", goNext);
    replayButton.removeEventListener("click", replayCurrent);
    resetButton.removeEventListener("click", resetCollection);
    closeLibrary();
  }

  function handleKeydown(event) {
    if (!isActive || event.altKey || event.ctrlKey || event.metaKey) return;

    const level = getCurrentLevel();
    const expected = level.code[typed.length];
    const key = normalizeKey(event.key);

    if (!key) return;
    event.preventDefault();
    enterKey(key);
  }

  function handleKeyboardPointer(event) {
    const button = event.target.closest("[data-typing-key]");
    if (!button || !keyboard.contains(button)) return;

    event.preventDefault();
    enterKey(button.dataset.typingKey);
  }

  function enterKey(key) {
    if (!isActive) return;

    const level = getCurrentLevel();
    const expected = level.code[typed.length];
    if (!expected) {
      goNext();
      return;
    }

    if (key === expected) {
      typed += expected;
      stage.classList.remove("is-mistake");

      if (typed === level.code) {
        unlocked.add(level.id);
        message.textContent = COMPLETE_MESSAGES[messageIndex % COMPLETE_MESSAGES.length];
        messageIndex += 1;
        stage.classList.add("is-complete");
        restartAnimation(flash, "is-flashing");
        celebrateUnlock(level);
      } else {
        message.textContent = "继续找下一个键";
      }

      render();
      return;
    }

    message.textContent = `找 ${expected} 键`;
    restartAnimation(stage, "is-mistake");
    restartAnimation(nextKey, "is-hinting");
    restartAnimation(keyboard, "is-mistake");
  }

  function normalizeKey(key) {
    if (key.length !== 1) return "";
    return key.toUpperCase();
  }

  function goNext() {
    currentIndex = (currentIndex + 1) % LEVELS.length;
    typed = unlocked.has(getCurrentLevel().id) ? getCurrentLevel().code : "";
    message.textContent = "按键开始解锁";
    closeLibrary();
    render();
  }

  function replayCurrent() {
    typed = "";
    message.textContent = "再来一次";
    closeLibrary();
    render();
  }

  function resetCollection() {
    unlocked = new Set();
    typed = "";
    currentIndex = 0;
    message.textContent = "车库已清空";
    closeLibrary();
    render();
  }

  function render() {
    const level = getCurrentLevel();
    const isComplete = typed === level.code;
    const reveal = Math.max(typed.length / level.code.length, unlocked.has(level.id) ? 1 : 0);
    const coverOpacity = 0.28 - reveal * 0.28;
    const blur = Math.max(0, 6 - reveal * 6);

    stage.classList.toggle("is-complete", isComplete);
    photo.dataset.scene = level.scene;
    photo.style.setProperty("--car-color", level.color);
    photo.style.setProperty("--car-accent", level.accent);
    photo.style.setProperty("--reveal", reveal.toString());
    photo.style.setProperty("--cover-opacity", coverOpacity.toString());
    photo.style.setProperty("--car-blur", `${blur}px`);
    photo.style.setProperty("--car-opacity", (0.72 + reveal * 0.28).toString());
    photo.style.setProperty("--car-scale", (0.96 + reveal * 0.04).toString());
    photo.style.backgroundImage = level.imageUrl ? `url("${level.imageUrl}")` : "";
    photo.classList.toggle("has-photo-asset", Boolean(level.imageUrl));
    cover.style.transform = `translateX(${reveal * 100}%)`;
    badge.textContent = `${level.maker} · ${currentIndex + 1} / ${LEVELS.length}`;
    renderTarget(level, isComplete);
    nextKey.textContent = level.code[typed.length] || "✓";
    count.textContent = `${unlocked.size} / ${LEVELS.length}`;
    libraryButton.textContent = `图鉴 ${unlocked.size}/${LEVELS.length}`;
    updateKeyboard(level);

    progress.replaceChildren(...level.code.split("").map((letter, index) => {
      const cell = document.createElement("span");
      cell.className = "typing-progress-cell";
      cell.textContent = index < typed.length ? letter : "";
      cell.classList.toggle("is-filled", index < typed.length);
      cell.classList.toggle("is-next", index === typed.length && !isComplete);
      return cell;
    }));

    renderCards();
  }

  function renderTarget(level, isComplete) {
    target.replaceChildren(...level.code.split("").map((letter, index) => {
      const character = document.createElement("span");
      character.className = "typing-target-letter";
      character.textContent = letter;
      character.classList.toggle("is-typed", index < typed.length);
      character.classList.toggle("is-current", index === typed.length && !isComplete);
      return character;
    }));
  }

  function renderKeyboard() {
    if (keyboard.childElementCount > 0) return;

    keyboard.replaceChildren(...KEYBOARD_ROWS.map((row) => {
      const rowElement = document.createElement("div");
      rowElement.className = "typing-keyboard-row";
      rowElement.replaceChildren(...row.map((key) => {
        const button = document.createElement("button");
        button.className = "typing-keyboard-key";
        button.type = "button";
        button.textContent = key;
        button.dataset.typingKey = key;
        button.setAttribute("aria-label", `${key} 键`);
        return button;
      }));
      return rowElement;
    }));
  }

  function updateKeyboard(level) {
    const expected = level.code[typed.length] || "";
    const used = new Set(typed.split(""));
    const needed = new Set(level.code.split(""));

    for (const button of keyboard.querySelectorAll("[data-typing-key]")) {
      const key = button.dataset.typingKey;
      button.classList.toggle("is-target", key === expected);
      button.classList.toggle("is-needed", needed.has(key));
      button.classList.toggle("is-used", used.has(key));
    }
  }

  function renderCards() {
    cards.replaceChildren(...LEVELS.map((level, index) => {
      const isUnlocked = unlocked.has(level.id);
      const card = document.createElement("button");
      card.className = "typing-garage-card";
      card.type = "button";
      card.disabled = !isUnlocked && index !== currentIndex;
      card.style.setProperty("--card-car-color", level.color);
      card.style.setProperty("--card-car-accent", level.accent);
      card.classList.toggle("is-current", index === currentIndex);
      card.classList.toggle("is-locked", !isUnlocked);
      card.setAttribute("aria-label", isUnlocked ? `查看 ${level.name}` : `${level.name} 未解锁`);
      card.innerHTML = `
        <span class="typing-garage-card-thumb" aria-hidden="true">
          <span></span>
        </span>
        <span class="typing-garage-card-copy">
          <strong>${isUnlocked ? level.name : "???"}</strong>
          <span>${isUnlocked ? level.maker : level.code.length + " 个键"}</span>
        </span>
      `;
      const thumb = card.querySelector(".typing-garage-card-thumb");
      if (level.imageUrl) {
        thumb.classList.add("has-photo-thumb");
        thumb.style.backgroundImage = `url("${level.imageUrl}")`;
      }
      card.addEventListener("click", () => {
        if (!isUnlocked && index !== currentIndex) return;
        currentIndex = index;
        typed = isUnlocked ? level.code : typed;
        message.textContent = isUnlocked ? "图鉴已解锁" : "继续这一辆";
        closeLibrary();
        render();
      });
      return card;
    }));
  }

  function openLibrary() {
    libraryPanel.classList.add("is-open");
    libraryBackdrop.hidden = false;
    libraryBackdrop.classList.add("is-open");
  }

  function closeLibrary() {
    libraryPanel.classList.remove("is-open");
    libraryBackdrop.classList.remove("is-open");
    libraryBackdrop.hidden = true;
  }

  function celebrateUnlock(level) {
    if (navigator.vibrate) {
      navigator.vibrate([35, 35, 55]);
    }

    restartAnimation(libraryButton, "is-pulsing");
    const flyCard = document.createElement("div");
    flyCard.className = "typing-unlock-card-fly";
    flyCard.innerHTML = `
      <span class="typing-unlock-card-fly-thumb"></span>
      <strong>${level.name}</strong>
      <span>${level.maker}</span>
    `;
    const thumb = flyCard.querySelector(".typing-unlock-card-fly-thumb");
    thumb.style.backgroundImage = `url("${level.imageUrl}")`;
    stage.append(flyCard);
    window.setTimeout(() => flyCard.remove(), 980);
  }

  function getCurrentLevel() {
    return LEVELS[currentIndex];
  }

  return { start, stop };
}

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
