(() => {
  "use strict";

  const body = document.body;
  const languageButtons = [...document.querySelectorAll(".language-switch [data-language]")];
  const stepButtons = [...document.querySelectorAll(".step-button[data-step]")];
  const status = document.getElementById("demo-status");
  const storyImage = document.getElementById("legacy-story-image");
  const storyToggle = document.getElementById("legacy-story-toggle");
  const quantity = { coffee: 3, cake: 3 };
  const unitPrice = { coffee: 25, cake: 50 };
  let storyTimer = 0;

  const state = {
    table: false,
    rule10: false,
    reviewed10: false,
    applied10: false,
    addedData: false,
    rule20: false,
    reviewed20: false,
    applied20: false,
    currentStep: 1,
    maxStep: 1,
  };

  const copy = {
    start: ["เริ่มจากโจทย์ แล้วสร้างโต๊ะตัวอย่าง", "Start with the brief to build the example table."],
    table: ["วางรายการตัวอย่างสองประเภทลงบนโต๊ะแล้ว", "Two sample sales categories are now on the table."],
    rule10: ["ร่างวิธีคำนวณ 10% แล้ว ตรวจดูก่อนเลือกใช้", "A 10% calculation is drafted. Review it before applying."],
    review10: ["ตรวจแล้ว · รอให้คุณเลือกใช้", "Reviewed · waiting for you to apply it."],
    applied10: ["ใช้ส่วนลด 10% กับยอดก่อนลด 225 แล้ว", "The 10% discount is applied to the 225 gross total."],
    updated: ["อัปเดตข้อมูลแล้ว ยอดก่อนลดเป็น 405 และยังใช้วิธีคำนวณเดิม", "Updated data brings gross to 405; the existing calculation is reused."],
    rule20: ["ร่างส่วนลด 20% แยกไว้ ยอดสุทธิเดิมยังไม่เปลี่ยน", "A separate 20% rule is proposed; the current net stays unchanged."],
    review20: ["ตรวจส่วนลด 20% แล้ว · ยังใช้ 10% จนกว่าคุณจะเลือกใช้กฎใหม่", "The 20% change is reviewed. The 10% rule stays active until you apply the change."],
    applied20: ["ใช้ส่วนลด 20% แล้ว · ยอดก่อนลดยังคงเป็น 405", "The 20% discount is applied. Gross remains 405."],
    reset: ["เริ่มใหม่ได้ทุกเมื่อ", "You can start over at any time."],
  };

  function currentLanguage() {
    return body.dataset.language === "en" ? "en" : "th";
  }

  function setStatus(key) {
    const [th, en] = copy[key];
    const thNode = status.querySelector('[data-status-language="th"]');
    const enNode = status.querySelector('[data-status-language="en"]');
    thNode.textContent = th;
    enNode.textContent = en;
  }

  function setResultNote(th, en) {
    const note = document.getElementById("result-note");
    note.querySelector('[data-lang="th"]').textContent = th;
    note.querySelector('[data-lang="en"]').textContent = en;
  }

  function setLanguage(language) {
    body.dataset.language = language;
    document.documentElement.lang = language;
    const film = document.getElementById("tabletop-film");
    film.setAttribute("aria-label", language === "en" ? "Tabletop concept animation with illustrative data" : "ภาพเคลื่อนไหวแนวคิดของ Tabletop พร้อมข้อมูลตัวอย่าง");
    languageButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
    const isEnglish = language === "en";
    document.querySelectorAll("[data-alt-th][data-alt-en]").forEach((image) => {
      image.alt = image.dataset[isEnglish ? "altEn" : "altTh"];
    });
    document.querySelectorAll("[data-aria-label-th][data-aria-label-en]").forEach((element) => {
      element.setAttribute("aria-label", element.dataset[isEnglish ? "ariaLabelEn" : "ariaLabelTh"]);
    });
    if (storyToggle) {
      storyToggle.setAttribute(
        "aria-label",
        isEnglish
          ? (storyToggle.dataset.playing === "true" ? "Stop the original animation" : "Play the original animation")
          : (storyToggle.dataset.playing === "true" ? "หยุดภาพเคลื่อนไหวเดิม" : "เล่นภาพเคลื่อนไหวเดิม"),
      );
    }
    if (status.dataset.message) setStatus(status.dataset.message);
  }

  languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLanguage(button.dataset.language);
      render();
    });
  });

  function formatAmount(amount) {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  }

  function grossTotal() {
    return quantity.coffee * unitPrice.coffee + quantity.cake * unitPrice.cake;
  }

  function activeDiscount() {
    if (state.applied20) return 20;
    if (state.applied10) return 10;
    return 0;
  }

  function describeActiveCalculation() {
    if (activeDiscount() === 20) {
      status.dataset.message = "applied20";
      setStatus("applied20");
      setResultNote("ส่วนลด 20% ที่ใช้แล้วมีผลกับยอดก่อนลด 405 · ยอดสุทธิ 324", "The applied 20% rule remains active on 405 gross; net is 324.");
    } else if (activeDiscount() === 10) {
      status.dataset.message = "applied10";
      setStatus("applied10");
      setResultNote("ใช้ 10% กับยอดก่อนลด " + formatAmount(grossTotal()), "10% is applied to gross of " + formatAmount(grossTotal()) + ".");
    } else {
      status.dataset.message = "table";
      setStatus("table");
      setResultNote("ยอดก่อนลดจะมาจากรายการบนโต๊ะ", "Gross is calculated from the records on the table.");
    }
  }

  function updateTable() {
    const coffeeTotal = quantity.coffee * unitPrice.coffee;
    const cakeTotal = quantity.cake * unitPrice.cake;
    const gross = grossTotal();
    document.getElementById("coffee-qty").textContent = String(quantity.coffee);
    document.getElementById("coffee-price").textContent = formatAmount(unitPrice.coffee);
    document.getElementById("coffee-total").textContent = formatAmount(coffeeTotal);
    document.getElementById("cake-qty").textContent = String(quantity.cake);
    document.getElementById("cake-price").textContent = formatAmount(unitPrice.cake);
    document.getElementById("cake-total").textContent = formatAmount(cakeTotal);
    document.getElementById("table-gross").textContent = formatAmount(gross);
    document.getElementById("record-count").textContent = "2";
    document.getElementById("gross-output").textContent = state.table
      ? formatAmount(gross)
      : (currentLanguage() === "en" ? "no data" : "ยังไม่มีข้อมูล");
    const discount = activeDiscount();
    document.getElementById("discount-output").textContent = discount
      ? discount + "%"
      : (currentLanguage() === "en" ? "none" : "ยังไม่ใช้");
    document.getElementById("net-output").textContent = discount
      ? formatAmount(Math.round(gross * (100 - discount)) / 100)
      : (currentLanguage() === "en" ? "not calculated" : "ยังไม่คำนวณ");
  }

  function updateRuleState() {
    const rule10State = document.getElementById("rule-10-state");
    const rule20State = document.getElementById("rule-20-state");
    rule10State.className = "rule-state";
    rule20State.className = "rule-state";

    if (!state.rule10) {
      rule10State.textContent = "";
    } else if (state.applied10 && !state.applied20) {
      rule10State.textContent = currentLanguage() === "en" ? "Applied · active" : "ใช้แล้ว · ทำงาน";
      rule10State.classList.add("is-applied");
    } else if (state.applied10 || (state.applied20 && state.reviewed10)) {
      rule10State.textContent = currentLanguage() === "en" ? "Saved · 10%" : "เก็บไว้ · 10%";
    } else if (state.reviewed10) {
      rule10State.textContent = currentLanguage() === "en" ? "Reviewed · draft" : "ตรวจแล้ว · ร่าง";
      rule10State.classList.add("is-draft");
    } else if (state.rule10) {
      rule10State.textContent = currentLanguage() === "en" ? "Draft · review" : "ร่าง · รอตรวจ";
      rule10State.classList.add("is-draft");
    }

    if (!state.rule20) {
      rule20State.textContent = "";
    } else if (state.applied20) {
      rule20State.textContent = currentLanguage() === "en" ? "Applied · active" : "ใช้แล้ว · ทำงาน";
      rule20State.classList.add("is-applied");
    } else if (state.reviewed20) {
      rule20State.textContent = currentLanguage() === "en" ? "Reviewed · pending" : "ตรวจแล้ว · รอใช้";
      rule20State.classList.add("is-draft");
    } else {
      rule20State.textContent = currentLanguage() === "en" ? "Draft · review" : "ร่าง · รอตรวจ";
      rule20State.classList.add("is-draft");
    }
  }

  function render() {
    document.getElementById("table-empty").hidden = state.table;
    document.getElementById("table-card").hidden = !state.table;
    document.getElementById("rule-10").hidden = !state.rule10;
    document.getElementById("rule-20").hidden = !state.rule20;
    document.getElementById("review-10").hidden = !state.rule10 || state.reviewed10;
    document.getElementById("apply-10").hidden = !state.rule10 || state.applied10 || state.applied20;
    document.getElementById("apply-10").disabled = !state.reviewed10;
    document.getElementById("review-20").hidden = !state.rule20 || state.reviewed20;
    document.getElementById("apply-20").hidden = !state.rule20 || state.applied20;
    document.getElementById("apply-20").disabled = !state.reviewed20;
    document.getElementById("board-demo").dataset.currentStep = String(state.currentStep);
    stepButtons.forEach((button) => {
      const step = Number(button.dataset.step);
      const current = step === state.currentStep;
      button.disabled = step > state.maxStep;
      button.classList.toggle("is-current", current);
      if (current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    updateTable();
    updateRuleState();
  }

  function goToStep(step) {
    if (step > state.maxStep) return;
    if (step === 3 && !state.applied10 && !state.applied20) return;
    if (step === 4 && !state.addedData) return;
    state.currentStep = step;
    if (step === 1 && !state.table) {
      state.table = true;
      state.maxStep = Math.max(state.maxStep, 2);
      status.dataset.message = "table";
      setStatus("table");
      setResultNote("ยอดก่อนลดจะมาจากรายการบนโต๊ะ", "Gross is calculated from the records on the table.");
    } else if (step === 1) {
      describeActiveCalculation();
    } else if (step === 2) {
      state.rule10 = true;
      state.maxStep = Math.max(state.maxStep, 2);
      if (activeDiscount()) describeActiveCalculation();
      else {
        status.dataset.message = "rule10";
        setStatus("rule10");
        setResultNote("ร่างแล้ว · ตรวจวิธีคำนวณก่อนใช้", "Drafted · review the calculation before applying it.");
      }
    } else if (step === 3) {
      quantity.coffee = 3;
      unitPrice.coffee = 35;
      quantity.cake = 6;
      state.addedData = true;
      state.maxStep = Math.max(state.maxStep, 4);
      if (activeDiscount() === 20) describeActiveCalculation();
      else {
        status.dataset.message = "updated";
        setStatus("updated");
        setResultNote("ใช้วิธีคำนวณ 10% เดิมกับยอดก่อนลด 405", "The existing 10% calculation is reused on 405 gross.");
      }
    } else if (step === 4) {
      state.rule20 = true;
      status.dataset.message = state.applied20 ? "applied20" : "rule20";
      setStatus(status.dataset.message);
      setResultNote(
        state.applied20 ? "ใช้ 20% กับยอดก่อนลด 405" : "10% ยังทำงาน · ร่าง 20% รอตรวจและเลือกใช้",
        state.applied20 ? "20% is applied to 405 gross." : "10% stays active · the 20% draft awaits review and apply.",
      );
    }
    render();
  }

  stepButtons.forEach((button) => {
    button.addEventListener("click", () => goToStep(Number(button.dataset.step)));
  });

  document.getElementById("review-10").addEventListener("click", () => {
    state.reviewed10 = true;
    status.dataset.message = "review10";
    setStatus("review10");
    setResultNote("ตรวจแล้ว · กด “ใช้วิธีคำนวณ” เพื่อเริ่มใช้ส่วนลด", "Reviewed · choose Apply calculation to start using the discount.");
    render();
    document.getElementById("apply-10").focus();
  });
  document.getElementById("apply-10").addEventListener("click", () => {
    if (!state.reviewed10) return;
    state.applied10 = true;
    state.currentStep = 2;
    state.maxStep = Math.max(state.maxStep, 3);
    status.dataset.message = "applied10";
    setStatus("applied10");
    setResultNote("ใช้ 10% กับยอดก่อนลด 225", "10% is applied to gross of 225.");
    render();
    stepButtons.find((button) => button.dataset.step === "3").focus();
  });
  document.getElementById("review-20").addEventListener("click", () => {
    state.reviewed20 = true;
    status.dataset.message = "review20";
    setStatus("review20");
    setResultNote("ตรวจแล้ว · ยอด 364.50 ยังคงใช้ส่วนลด 10% จนกว่าจะกดใช้", "Reviewed · net stays 364.50 at 10% until you apply the new rule.");
    render();
    document.getElementById("apply-20").focus();
  });
  document.getElementById("apply-20").addEventListener("click", () => {
    if (!state.reviewed20) return;
    state.applied20 = true;
    state.applied10 = false;
    state.currentStep = 4;
    status.dataset.message = "applied20";
    setStatus("applied20");
    setResultNote("ใช้ 20% กับยอดก่อนลด 405 · ยอดสุทธิ 324", "20% is applied to 405 gross · net is 324.");
    render();
    document.getElementById("result-title").focus();
  });

  document.getElementById("reset-example").addEventListener("click", () => {
    Object.assign(state, {
      table: false,
      rule10: false,
      reviewed10: false,
      applied10: false,
      addedData: false,
      rule20: false,
      reviewed20: false,
      applied20: false,
      currentStep: 1,
      maxStep: 1,
    });
    quantity.coffee = 3;
    quantity.cake = 3;
    unitPrice.coffee = 25;
    unitPrice.cake = 50;
    status.dataset.message = "reset";
    setStatus("reset");
    setResultNote("ยังไม่มีวิธีคำนวณบนโต๊ะ", "No calculation on the table yet.");
    render();
    stepButtons[0].focus();
  });

  function stopStory() {
    window.clearTimeout(storyTimer);
    storyTimer = 0;
    if (!storyToggle || storyToggle.dataset.playing !== "true") return;
    storyImage.src = storyImage.dataset.poster;
    storyToggle.dataset.playing = "false";
    storyToggle.setAttribute("aria-pressed", "false");
    storyToggle.setAttribute(
      "aria-label",
      currentLanguage() === "en" ? "Play the original animation" : "เล่นภาพเคลื่อนไหวเดิม",
    );
  }

  if (storyToggle && storyImage) {
    storyToggle.addEventListener("click", () => {
      if (storyToggle.dataset.playing === "true") {
        stopStory();
        return;
      }
      storyToggle.dataset.playing = "true";
      storyToggle.setAttribute("aria-pressed", "true");
      storyToggle.setAttribute(
        "aria-label",
        currentLanguage() === "en" ? "Stop the original animation" : "หยุดภาพเคลื่อนไหวเดิม",
      );
      storyImage.src = storyImage.dataset.animation + "?play=" + Date.now();
      storyTimer = window.setTimeout(stopStory, 20000);
    });
  }

  setLanguage(body.dataset.language || "th");
  setStatus("start");
  render();
})();
