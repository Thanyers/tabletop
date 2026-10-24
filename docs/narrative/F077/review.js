(() => {
  "use strict";

  const body = document.body;
  const languageButtons = [...document.querySelectorAll(".language-switch [data-language]")];
  const chapterButtons = [...document.querySelectorAll(".step-button[data-chapter]")];
  const input = document.getElementById("request-input");
  const sendButton = document.getElementById("send-request");
  const cancelButton = document.getElementById("cancel-typing");
  const reviewButton = document.getElementById("review-change");
  const applyButton = document.getElementById("apply-change");
  const status = document.getElementById("demo-status");
  const statusTh = status.querySelector('[data-status-language="th"]');
  const statusEn = status.querySelector('[data-status-language="en"]');
  const resultNote = document.getElementById("result-note");
  const draftSummary = document.getElementById("draft-summary");
  const requestContext = document.getElementById("request-context");
  const storyImage = document.getElementById("legacy-story-image");
  const storyToggle = document.getElementById("legacy-story-toggle");
  const quantities = { coffee: 3, cake: 3 };
  const unitPrices = { coffee: 25, cake: 50 };
  let storyTimer = 0;
  let typingTimer = 0;
  let typingToken = 0;

  const prompts = {
    1: { th: "ช่วยทำโต๊ะจดขายกาแฟกับเค้ก", en: "Make a table to record coffee and cake sales" },
    2: { th: "เพิ่มปุ่มขาย กดครั้งเดียวเพิ่มจำนวน", en: "Add quick-sale buttons that increase quantity once" },
    3: { th: "เพิ่มกราฟยอดขายแยกตามสินค้า", en: "Add a sales chart by item" },
    4: { th: "เพิ่มส่วนลด 10%", en: "Add a 10% discount" },
    5: { th: "เปลี่ยนกฎนี้เป็น 20%", en: "Change this rule to 20%" },
  };
  const contexts = {
    1: { th: "เริ่มจากรายการขายกาแฟและเค้ก", en: "Start with coffee and cake sales." },
    2: { th: "กรอกไม่ทันตอนลูกค้าเข้าร้านพร้อมกัน", en: "Busy service makes it hard to keep up with entry." },
    3: { th: "อยากรู้ว่าอะไรขายดี", en: "You want to see which item sells more." },
    4: { th: "ลองโปรช่วงบ่าย", en: "Try an afternoon offer." },
    5: { th: "เลือกกฎส่วนลดเดิมเพื่อปรับต่อ", en: "Select the existing discount rule to change it." },
  };
  const state = {
    chapter: 1,
    maxChapter: 1,
    phase: "idle",
    request: "",
    requestIsPreset: true,
    discount: 0,
    savedTenPercent: false,
    tableApplied: false,
    quickActionsApplied: false,
    chartApplied: false,
  };

  function language() {
    return body.dataset.language === "en" ? "en" : "th";
  }

  function setStatus(th, en) {
    statusTh.textContent = th;
    statusEn.textContent = en;
  }

  function setResultNote(th, en) {
    resultNote.querySelector('[data-lang="th"]').textContent = th;
    resultNote.querySelector('[data-lang="en"]').textContent = en;
  }

  function setChapterContext(chapter) {
    requestContext.querySelector('[data-context-language="th"]').textContent = contexts[chapter].th;
    requestContext.querySelector('[data-context-language="en"]').textContent = contexts[chapter].en;
  }

  function cancelTypewriter() {
    window.clearTimeout(typingTimer);
    typingTimer = 0;
    typingToken += 1;
  }

  function setLanguage(nextLanguage) {
    body.dataset.language = nextLanguage;
    document.documentElement.lang = nextLanguage;
    const isEnglish = nextLanguage === "en";
    document.getElementById("tabletop-film").setAttribute(
      "aria-label",
      isEnglish ? "Tabletop concept animation with illustrative data" : "ภาพเคลื่อนไหวแนวคิดของ Tabletop พร้อมข้อมูลตัวอย่าง",
    );
    languageButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.language === nextLanguage)));
    document.querySelectorAll("[data-alt-th][data-alt-en]").forEach((image) => {
      image.alt = image.dataset[isEnglish ? "altEn" : "altTh"];
    });
    document.querySelectorAll("[data-aria-label-th][data-aria-label-en]").forEach((element) => {
      element.setAttribute("aria-label", element.dataset[isEnglish ? "ariaLabelEn" : "ariaLabelTh"]);
    });
    document.querySelectorAll("[data-placeholder-th][data-placeholder-en]").forEach((element) => {
      element.placeholder = element.dataset[isEnglish ? "placeholderEn" : "placeholderTh"];
    });
    if (storyToggle) {
      storyToggle.setAttribute(
        "aria-label",
        isEnglish
          ? (storyToggle.dataset.playing === "true" ? "Stop the original animation" : "Play the original animation")
          : (storyToggle.dataset.playing === "true" ? "หยุดภาพเคลื่อนไหวเดิม" : "เล่นภาพเคลื่อนไหวเดิม"),
      );
    }
    if (state.requestIsPreset && state.request) {
      state.request = prompts[state.chapter][nextLanguage];
      input.value = state.request;
    }
    if (state.phase === "typing" || state.phase === "ready") {
      cancelTypewriter();
      state.request = prompts[state.chapter][nextLanguage];
      state.requestIsPreset = true;
      state.phase = "ready";
      input.value = state.request;
      input.disabled = false;
      setStatus(
        "เปลี่ยนภาษาแล้ว · คำขอพร้อมส่งเมื่อคุณกดปุ่ม",
        "Language changed · the request is ready when you choose to send it.",
      );
    }
    render();
  }

  languageButtons.forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });

  function formatAmount(value) {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
  }

  function lineTotal(item) {
    return quantities[item] * unitPrices[item];
  }

  function grossTotal() {
    return lineTotal("coffee") + lineTotal("cake");
  }

  function netTotal(rate) {
    const discountRate = typeof rate === "number" ? rate : state.discount;
    return Math.round(grossTotal() * (100 - discountRate)) / 100;
  }

  function stagePending(chapter) {
    return state.chapter === chapter && (state.phase === "sent" || state.phase === "reviewed");
  }

  function activeDraft() {
    return state.phase === "sent" || state.phase === "reviewed";
  }

  function writePromptCopy() {
    const th = document.querySelector('#request-copy [data-lang="th"]');
    const en = document.querySelector('#request-copy [data-lang="en"]');
    if (!state.request || state.phase === "idle" || state.phase === "typing" || state.phase === "ready") {
      th.textContent = "คำขอที่ส่งจะแสดงตรงนี้";
      en.textContent = "The sent request will appear here.";
      return;
    }
    if (state.requestIsPreset) {
      th.textContent = "“" + prompts[state.chapter].th + "”";
      en.textContent = "“" + prompts[state.chapter].en + "”";
    } else {
      th.textContent = "“" + state.request + "”";
      en.textContent = "“" + state.request + "”";
      th.lang = language();
      en.lang = language();
    }
  }

  function makeDraftSummary() {
    const gross = formatAmount(grossTotal());
    const discount = state.discount;
    const currentNet = discount ? formatAmount(netTotal(discount)) : "—";
    switch (state.chapter) {
      case 1:
        return [
          "ร่างโต๊ะ 2 รายการ · ยอดก่อนลด " + gross + " · ตรวจแล้วกดใช้เพื่อวางลงบนโต๊ะ",
          "Draft table: 2 items · gross " + gross + " · review then apply to place it on the canvas.",
        ];
      case 2:
        return [
          "ร่างปุ่มเพิ่มจำนวน · กาแฟ " + quantities.coffee + " แก้ว · เค้ก " + quantities.cake + " ชิ้น · ยอดก่อนลด " + gross,
          "Draft quick-add actions · coffee " + quantities.coffee + " · cake " + quantities.cake + " · gross " + gross + ".",
        ];
      case 3:
        return [
          "ร่างกราฟจากรายการเดิม · กาแฟ " + formatAmount(lineTotal("coffee")) + " · เค้ก " + formatAmount(lineTotal("cake")),
          "Draft chart from the same rows · coffee " + formatAmount(lineTotal("coffee")) + " · cake " + formatAmount(lineTotal("cake")) + ".",
        ];
      case 4: {
        const proposedNet = formatAmount(netTotal(10));
        const current = discount ? " · ตอนนี้ใช้ " + discount + "% ยอดสุทธิ " + currentNet : " · ยังไม่มีส่วนลดที่ใช้";
        const currentEn = discount ? " · currently " + discount + "% with net " + currentNet : " · no discount is active";
        return [
          "ร่างส่วนลด 10% · ยอดก่อนลดยังคง " + gross + " · ยอดสุทธิหลังใช้ " + proposedNet + current,
          "Draft 10% discount · gross remains " + gross + " · net after applying " + proposedNet + currentEn + ".",
        ];
      }
      default: {
        const proposedNet = formatAmount(netTotal(20));
        const current = discount ? "ขณะนี้ " + discount + "% · ยอดสุทธิ " + currentNet : "ขณะนี้ยังไม่มีส่วนลดที่ใช้";
        const currentEn = discount ? "currently " + discount + "% · net " + currentNet : "no discount is currently active";
        return [
          "ร่างเปลี่ยนเป็น 20% · ยอดก่อนลดยังคง " + gross + " · " + current + " · หลังใช้กฎใหม่ยอดสุทธิ " + proposedNet,
          "Draft change to 20% · gross remains " + gross + " · " + currentEn + " · net after applying " + proposedNet + ".",
        ];
      }
    }
  }

  function updateResult() {
    const hasTable = state.tableApplied || stagePending(1);
    const gross = grossTotal();
    document.getElementById("coffee-qty").textContent = String(quantities.coffee);
    document.getElementById("coffee-price").textContent = formatAmount(unitPrices.coffee);
    document.getElementById("coffee-total").textContent = formatAmount(lineTotal("coffee"));
    document.getElementById("cake-qty").textContent = String(quantities.cake);
    document.getElementById("cake-price").textContent = formatAmount(unitPrices.cake);
    document.getElementById("cake-total").textContent = formatAmount(lineTotal("cake"));
    document.getElementById("table-gross").textContent = formatAmount(gross);
    document.getElementById("record-count").textContent = "2";
    const tableState = document.getElementById("table-state");
    tableState.classList.toggle("is-draft", !state.tableApplied);
    tableState.textContent = state.tableApplied
      ? (language() === "en" ? "On canvas" : "อยู่บนโต๊ะ")
      : (language() === "en" ? "Draft · review" : "ร่าง · รอตรวจ");
    document.getElementById("gross-output").textContent = hasTable
      ? formatAmount(gross)
      : (language() === "en" ? "no data" : "ยังไม่มีข้อมูล");
    document.getElementById("discount-output").textContent = state.discount
      ? state.discount + "%"
      : (language() === "en" ? "none" : "ยังไม่ใช้");
    document.getElementById("net-output").textContent = state.discount
      ? formatAmount(netTotal())
      : (language() === "en" ? "not calculated" : "ยังไม่คำนวณ");

    if (state.discount) {
      const amount = formatAmount(netTotal());
      const historyTh = state.discount === 20 && state.savedTenPercent ? " · กฎ 10% เดิมยังเก็บไว้" : "";
      const historyEn = state.discount === 20 && state.savedTenPercent ? " · the previous 10% rule is retained" : "";
      setResultNote(
        "ใช้ " + state.discount + "% · ยอดก่อนลด " + formatAmount(gross) + " · ยอดสุทธิ " + amount + historyTh,
        state.discount + "% applied · gross " + formatAmount(gross) + " · net " + amount + historyEn,
      );
    } else if (stagePending(4)) {
      setResultNote("ร่าง 10% ยังไม่ทำงาน · ยอดก่อนลด " + formatAmount(gross), "The 10% draft is not active · gross " + formatAmount(gross) + ".");
    } else if (stagePending(5)) {
      setResultNote(
        "10% ยังทำงานอยู่ · ยอดก่อนลด " + formatAmount(gross) + " · ยอดสุทธิ " + formatAmount(netTotal(10)),
        "10% remains active · gross " + formatAmount(gross) + " · net " + formatAmount(netTotal(10)) + ".",
      );
    } else if (hasTable) {
      setResultNote("ยอดก่อนลดคำนวณจากรายการบนโต๊ะ · " + formatAmount(gross), "Gross is calculated from the sales rows · " + formatAmount(gross) + ".");
    } else {
      setResultNote("ยังไม่มีวิธีคำนวณบนโต๊ะ", "No calculation on the table yet.");
    }
  }

  function updateChart() {
    const coffee = lineTotal("coffee");
    const cake = lineTotal("cake");
    const max = Math.max(coffee, cake, 1);
    document.getElementById("coffee-bar").style.width = Math.max(2, coffee / max * 100) + "%";
    document.getElementById("cake-bar").style.width = Math.max(2, cake / max * 100) + "%";
    document.getElementById("coffee-bar-value").textContent = formatAmount(coffee);
    document.getElementById("cake-bar-value").textContent = formatAmount(cake);
  }

  function updateRuleStates() {
    const rule10State = document.getElementById("rule-10-state");
    const rule20State = document.getElementById("rule-20-state");
    rule10State.className = "rule-state";
    rule20State.className = "rule-state";
    if (state.discount === 10) {
      rule10State.textContent = language() === "en" ? "Applied · active" : "ใช้แล้ว · ทำงาน";
      rule10State.classList.add("is-applied");
    } else if (state.savedTenPercent) {
      rule10State.textContent = language() === "en" ? "Saved · previous rule" : "เก็บไว้ · กฎเดิม";
    } else if (stagePending(4)) {
      rule10State.textContent = state.phase === "reviewed"
        ? (language() === "en" ? "Reviewed · draft" : "ตรวจแล้ว · ร่าง")
        : (language() === "en" ? "Draft · review" : "ร่าง · รอตรวจ");
      rule10State.classList.add("is-draft");
    } else {
      rule10State.textContent = "";
    }
    if (state.discount === 20) {
      rule20State.textContent = language() === "en" ? "Applied · active" : "ใช้แล้ว · ทำงาน";
      rule20State.classList.add("is-applied");
    } else if (stagePending(5)) {
      rule20State.textContent = state.phase === "reviewed"
        ? (language() === "en" ? "Reviewed · pending" : "ตรวจแล้ว · รอใช้")
        : (language() === "en" ? "Draft · review" : "ร่าง · รอตรวจ");
      rule20State.classList.add("is-draft");
    } else {
      rule20State.textContent = "";
    }
  }

  function render() {
    const draft = activeDraft();
    const tableVisible = state.tableApplied || stagePending(1);
    const quickPreview = stagePending(2);
    const chartPreview = stagePending(3);
    const discount10Visible = state.discount === 10 || state.savedTenPercent || stagePending(4);
    const discount20Visible = state.discount === 20 || stagePending(5);
    document.getElementById("table-empty").hidden = tableVisible;
    document.getElementById("table-card").hidden = !tableVisible;
    document.getElementById("sales-actions").hidden = !(state.quickActionsApplied || quickPreview);
    document.getElementById("quick-coffee").disabled = !state.quickActionsApplied;
    document.getElementById("quick-cake").disabled = !state.quickActionsApplied;
    document.getElementById("sales-chart").hidden = !(state.chartApplied || chartPreview);
    document.getElementById("rule-10").hidden = !discount10Visible;
    document.getElementById("rule-20").hidden = !discount20Visible;
    input.disabled = state.phase === "idle" || state.phase === "sent" || state.phase === "reviewed" || state.phase === "applied";
    document.getElementById("board-demo").dataset.currentChapter = String(state.chapter);
    chapterButtons.forEach((button) => {
      const chapter = Number(button.dataset.chapter);
      const current = chapter === state.chapter;
      button.disabled = chapter > state.maxChapter;
      button.classList.toggle("is-current", current);
      if (current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    cancelButton.hidden = state.phase !== "typing";
    sendButton.disabled = state.phase === "typing" || state.phase === "idle" || !input.value.trim() || state.phase === "sent" || state.phase === "reviewed" || state.phase === "applied";
    reviewButton.hidden = state.phase !== "sent";
    applyButton.hidden = state.phase !== "reviewed";
    applyButton.disabled = state.phase !== "reviewed";
    draftSummary.hidden = !draft;
    if (draft) {
      const pair = makeDraftSummary();
      draftSummary.querySelector('[data-lang="th"]').textContent = pair[0];
      draftSummary.querySelector('[data-lang="en"]').textContent = pair[1];
    }
    writePromptCopy();
    updateResult();
    updateChart();
    updateRuleStates();
  }

  function graphemes(value) {
    if (typeof Intl.Segmenter === "function") {
      return [...new Intl.Segmenter(language(), { granularity: "grapheme" }).segment(value)].map((part) => part.segment);
    }
    return Array.from(value);
  }

  function selectChapter(chapter) {
    if (chapter > state.maxChapter) return;
    cancelTypewriter();
    state.chapter = chapter;
    state.phase = "typing";
    setChapterContext(chapter);
    state.request = prompts[chapter][language()];
    state.requestIsPreset = true;
    input.disabled = false;
    input.value = "";
    input.placeholder = "";
    render();
    const token = typingToken;
    const characters = graphemes(state.request);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      input.value = state.request;
      input.setSelectionRange(input.value.length, input.value.length);
      state.phase = "ready";
      setStatus("คำขอพร้อมแล้ว · กดส่งเมื่อคุณต้องการ", "The request is ready · send it when you choose.");
      render();
      return;
    }
    let index = 0;
    input.focus();
    setStatus("กำลังพิมพ์คำขอตัวอย่าง · กดหยุดได้ทุกเมื่อ", "Typing the sample request · stop typing at any time.");
    const typeNext = () => {
      if (token !== typingToken || state.phase !== "typing") return;
      index += 1;
      input.value = characters.slice(0, index).join("");
      input.setSelectionRange(input.value.length, input.value.length);
      if (index >= characters.length) {
        typingTimer = 0;
        state.phase = "ready";
        setStatus("คำขอพร้อมแล้ว · กดส่งเมื่อคุณต้องการ", "The request is ready · send it when you choose.");
        render();
      } else {
        typingTimer = window.setTimeout(typeNext, 34);
      }
    };
    typingTimer = window.setTimeout(typeNext, 34);
  }

  chapterButtons.forEach((button) => {
    button.addEventListener("click", () => selectChapter(Number(button.dataset.chapter)));
  });

  cancelButton.addEventListener("click", () => {
    if (state.phase !== "typing") return;
    cancelTypewriter();
    state.request = prompts[state.chapter][language()];
    state.requestIsPreset = true;
    input.value = state.request;
    state.phase = "ready";
    setStatus("แสดงคำขอครบแล้ว · กดส่งเมื่อคุณต้องการ", "The full request is shown · send it when you choose.");
    render();
    sendButton.focus();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.phase === "typing") {
      event.preventDefault();
      cancelButton.click();
    }
  });

  sendButton.addEventListener("click", () => {
    if (state.phase !== "ready" || !input.value.trim()) return;
    state.request = input.value.trim();
    state.requestIsPreset = state.request === prompts[state.chapter][language()];
    state.phase = "sent";
    setStatus("คำขออยู่ในภาพจำลองแล้ว · ตรวจร่างก่อนกดใช้", "The request is in the local illustration · review the draft before applying it.");
    render();
    reviewButton.focus();
  });

  reviewButton.addEventListener("click", () => {
    if (state.phase !== "sent") return;
    state.phase = "reviewed";
    setStatus("ตรวจร่างแล้ว · เลือกใช้การเปลี่ยนแปลงเมื่อพร้อม", "Draft reviewed · apply the change when ready.");
    render();
    applyButton.focus();
  });

  applyButton.addEventListener("click", () => {
    if (state.phase !== "reviewed") return;
    const appliedChapter = state.chapter;
    switch (appliedChapter) {
      case 1:
        state.tableApplied = true;
        state.maxChapter = Math.max(state.maxChapter, 2);
        break;
      case 2:
        state.quickActionsApplied = true;
        state.maxChapter = Math.max(state.maxChapter, 3);
        break;
      case 3:
        state.chartApplied = true;
        state.maxChapter = Math.max(state.maxChapter, 4);
        break;
      case 4:
        state.discount = 10;
        state.savedTenPercent = true;
        state.maxChapter = Math.max(state.maxChapter, 5);
        break;
      case 5:
        state.savedTenPercent = true;
        state.discount = 20;
        break;
      default:
        return;
    }
    state.phase = "applied";
    const gross = formatAmount(grossTotal());
    if (appliedChapter === 1) {
      setStatus("วางโต๊ะขายแล้ว · กาแฟ 3×25 + เค้ก 3×50 = " + gross, "Sales table applied · coffee 3×25 + cake 3×50 = " + gross + ".");
    } else if (appliedChapter === 2) {
      setStatus("เพิ่มปุ่มขายแล้ว · ลองกดกาแฟหรือเค้กเพื่อเพิ่มจำนวน", "Quick-sale buttons applied · try Coffee or Cake to add one.");
    } else if (appliedChapter === 3) {
      setStatus("เพิ่มกราฟแล้ว · กราฟอ่านจากรายการขายชุดเดียวกัน", "Chart applied · it reads the same sales rows.");
    } else if (appliedChapter === 4) {
      setStatus("ใช้ส่วนลด 10% แล้ว · ยอดก่อนลด " + gross + " · ยอดสุทธิ " + formatAmount(netTotal()), "10% discount applied · gross " + gross + " · net " + formatAmount(netTotal()) + ".");
    } else {
      setStatus("ใช้ส่วนลด 20% แล้ว · ยอดก่อนลด " + gross + " · ยอดสุทธิ " + formatAmount(netTotal()) + " · เก็บกฎ 10% เดิมไว้", "20% discount applied · gross " + gross + " · net " + formatAmount(netTotal()) + " · previous 10% rule retained.");
    }
    render();
    if (appliedChapter === 1 || appliedChapter === 3 || appliedChapter === 4) {
      chapterButtons.find((button) => Number(button.dataset.chapter) === appliedChapter + 1).focus();
    } else if (appliedChapter === 2) {
      document.getElementById("quick-coffee").focus();
    } else {
      document.getElementById("result-title").focus();
    }
  });

  function addSale(item) {
    if (!state.quickActionsApplied) return;
    quantities[item] += 1;
    const itemName = item === "coffee" ? (language() === "en" ? "Coffee" : "กาแฟ") : (language() === "en" ? "Cake" : "เค้ก");
    const discountPartTh = state.discount ? " · ยอดสุทธิ " + formatAmount(netTotal()) : "";
    const discountPartEn = state.discount ? " · net " + formatAmount(netTotal()) : "";
    setStatus(
      itemName + " +1 · ยอดก่อนลด " + formatAmount(grossTotal()) + discountPartTh,
      itemName + " +1 · gross " + formatAmount(grossTotal()) + discountPartEn + ".",
    );
    render();
    document.getElementById(item === "coffee" ? "quick-coffee" : "quick-cake").focus();
  }

  document.getElementById("quick-coffee").addEventListener("click", () => addSale("coffee"));
  document.getElementById("quick-cake").addEventListener("click", () => addSale("cake"));

  document.getElementById("reset-example").addEventListener("click", () => {
    cancelTypewriter();
    quantities.coffee = 3;
    quantities.cake = 3;
    Object.assign(state, {
      chapter: 1,
      maxChapter: 1,
      phase: "idle",
      request: "",
      requestIsPreset: true,
      discount: 0,
      savedTenPercent: false,
      tableApplied: false,
      quickActionsApplied: false,
      chartApplied: false,
    });
    input.value = "";
    input.disabled = true;
    input.placeholder = input.dataset[language() === "en" ? "placeholderEn" : "placeholderTh"];
    setChapterContext(1);
    setStatus("เริ่มใหม่ได้ทุกเมื่อ · เลือกคำขอตัวอย่างแรกเพื่อเริ่ม", "Reset complete · choose the first sample request to begin.");
    render();
    chapterButtons[0].focus();
  });

  function stopStory() {
    window.clearTimeout(storyTimer);
    storyTimer = 0;
    if (!storyToggle || storyToggle.dataset.playing !== "true") return;
    storyImage.src = storyImage.dataset.poster;
    storyToggle.dataset.playing = "false";
    storyToggle.setAttribute("aria-pressed", "false");
    storyToggle.setAttribute("aria-label", language() === "en" ? "Play the original animation" : "เล่นภาพเคลื่อนไหวเดิม");
  }

  if (storyToggle && storyImage) {
    storyToggle.addEventListener("click", () => {
      if (storyToggle.dataset.playing === "true") {
        stopStory();
        return;
      }
      storyToggle.dataset.playing = "true";
      storyToggle.setAttribute("aria-pressed", "true");
      storyToggle.setAttribute("aria-label", language() === "en" ? "Stop the original animation" : "หยุดภาพเคลื่อนไหวเดิม");
      storyImage.src = storyImage.dataset.animation + "?play=" + Date.now();
      storyTimer = window.setTimeout(stopStory, 20000);
    });
  }

  input.disabled = true;
  setLanguage(body.dataset.language || "th");
  render();
})();
