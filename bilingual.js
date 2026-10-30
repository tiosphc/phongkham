/* Vietnamese first, with a smaller Japanese line for app controls and labels. */
'use strict';

window.TBVNBilingual = (() => {
  const techNames = {
    '1': ['Tư vấn da cơ bản', '基本スキンカウンセリング'],
    '2': ['Chăm sóc da chuyên sâu', '集中スキンケア'],
    '3': ['Lấy nhân mụn', 'コメド圧出'],
    '4': ['Tiêm điều trị sẹo lồi', 'ケロイド注射治療'],
    '5': ['Tiêm Mesotherapy', 'メソセラピー'],
    '6': ['Tiêm BAP', 'BAP注入'],
    '7': ['Tiêm Botox', 'ボトックス注入'],
    '8': ['Filler / PRF / Chất kích thích sinh học', 'フィラー・PRF・バイオスティミュレーター'],
    '10': ['Peel hóa học', 'ケミカルピーリング'],
    '11': ['Laser Pico', 'ピコレーザー'],
    '11b': ['Laser CO₂ Fractional', 'フラクショナルCO₂レーザー'],
    '12': ['Nâng cơ HIFU', 'HIFUリフトアップ'],
    '13': ['Điều trị bằng Laser (CO₂ / 532nm)', 'レーザー治療（CO₂・532nm）'],
    '+': ['Thao tác bổ sung', '追加処置']
  };
  const groupJp = Object.fromEntries(CATALOG.techs.map(t => [t.group_vi, t.group_jp]));
  groupJp['Thao tác bổ sung'] = '追加処置';
  const serviceJp = Object.fromEntries(CATALOG.techs.flatMap(t => t.inds.map((ind, i) => [`${t.stt}:${i}`, ind.jp])));
  Object.assign(serviceJp, { 'extra:0': '基本処置', 'extra:1': '麻酔クリーム塗布', 'extra:2': 'PRP・PRF用採血と遠心分離' });

  const textJp = {
    'Theo dõi thời gian điều trị': '施術時間の管理',
    'TBVN · ĐIỀU PHỐI CA ĐIỀU TRỊ': 'TBVN · 施術管理',
    'Tạo ca, tính tổng thời gian, ước tính giờ hoàn thành và chạy đồng hồ cho từng khách ngay trên một màn hình.': '施術の作成、時間の集計、終了予定時刻とタイマーを一画面で確認できます。',
    'Timeline trong ngày': '一日のタイムライン',
    'Điều phối phòng điều trị': '施術室の管理',
    'Theo dõi các ca chưa hoàn tất trong từng phòng.': '各施術室の進行中の施術を確認できます。',
    'Danh sách ca điều trị': '施術一覧',
    'Thông tin ca điều trị': '施術情報',
    'Tuổi': '年齢',
    'DR': '医師',
    'Phòng điều trị': '施術室',
    'Giờ hẹn / Bắt đầu': '予約・開始時刻',
    'Chưa phân phòng': '未割り当て',
    'Chưa cập nhật': '未入力',
    'Chưa có ca hoạt động': '進行中の施術はありません',
    'Tất cả phòng': 'すべての部屋',
    'Treatment 1': '治療室1',
    'Treatment 2': '治療室2',
    'Treatment 3': '治療室3',
    'Bảng thời lượng kỹ thuật': '施術時間表',
    'Danh sách kỹ thuật': '施術技術一覧',
    'Chọn chỉ định điều trị': '治療項目を選択',
    'Chỉnh sửa ca điều trị': '施術内容を編集',
    'Tạo ca điều trị mới': '新しい施術を作成',
    '01 · Chọn kỹ thuật': '01 · 技術を選択',
    '02 · Đã chọn': '02 · 選択済み',
    'Tổng ca': '施術総数',
    'Đang chạy': '進行中',
    'Tổng phút dự kiến': '予定時間の合計',
    'Quá giờ điều trị': '施術時間超過',
    'Tổng thời lượng': '合計時間',
    'Số dịch vụ': 'サービス数',
    'Trùng lịch hẹn': '予約時間の重複',
    'Ca đang chạy cùng lúc': '同時進行中の施術',
    'Ngày hẹn điều trị': '施術予約日',
    'Giờ hẹn điều trị': '施術予約時刻',
    'THỜI GIAN CÒN LẠI': '残り時間',
    'QUÁ GIỜ ĐIỀU TRỊ': '施術時間超過',
    'THỜI LƯỢNG ĐIỀU TRỊ (CHƯA CHẠY)': '施術予定時間（未開始）',
    'ĐÃ HOÀN THÀNH': '完了',
    'Chưa bắt đầu': '開始前',
    'Tạm dừng': '一時停止',
    'Hoàn tất': '完了',
    'Chỉ định': '治療項目',
    'Thời gian': '時間',
    'Tên khách hàng': 'お客様名',
    'Tuổi (tùy chọn)': '年齢（任意）',
    'Giới tính': '性別',
    'Giờ hẹn / bắt đầu': '予約・開始時刻',
    'DR (tùy chọn)': '医師（任意）',
    'TỔNG THỜI GIAN DỰ KIẾN': '予定合計時間',
    'GIỜ DỰ KIẾN HOÀN THÀNH': '終了予定時刻',
    'KẾT THÚC THEO LỊCH': '予約上の終了時刻',
    'Phút': '分',
    'Số nốt': '個数',
    'Đang theo dõi trên các thiết bị': '各端末で共有中',
    'Đồng hồ đang hoạt động': 'タイマーが作動中',
    'Cộng của tất cả các ca': '全施術の合計',
    'Cần kiểm tra lại tiến độ': '進行状況をご確認ください',
    'Viền: lịch hẹn · Màu: điều trị thực tế': '枠線：予約時間・色：実際の施術',
    'Không có ca điều trị trong ngày hôm nay.': '本日の施術はありません。',
    'Khách hàng': 'お客様',
    'THỜI GIAN THỰC': '現在時刻',
    'Đã kết nối dữ liệu': 'データ接続済み',
    'Đồng bộ gián đoạn': '同期が中断されました',
    'Đang kết nối dữ liệu': 'データに接続中',
    'Ca điều trị được đồng bộ và tự hết hạn sau 30 ngày': '施術データは同期され、30日後に自動で期限切れとなります',
    'Xem nhanh khung giờ của từng khách và phát hiện ca trùng nhau.': '各お客様の時間帯と重複を確認できます。',
    'Theo dõi đồng hồ và điều chỉnh thời lượng trên các thiết bị cùng mở website.': '複数の端末でタイマーと施術時間を確認・調整できます。',
    'Chọn kỹ thuật trước, sau đó chọn chỉ định điều trị tương ứng.': '先に技術を選び、続いて治療項目を選択してください。',
    'Tên kỹ thuật được hiển thị lớn. Bấm vào một kỹ thuật để mở nhóm chỉ định điều trị của nó.': '技術を選ぶと、対応する治療項目が開きます。',
    'Nhóm dịch vụ chỉ dùng để lọc. Tên kỹ thuật được ưu tiên hiển thị lớn hơn.': 'サービス分類で絞り込み、技術名を確認できます。',
    'Lọc theo nhóm dịch vụ, xem kỹ thuật lớn rõ ràng và bấm vào để mở danh sách chỉ định điều trị.': 'サービス分類で絞り込み、技術を選んで治療項目を表示できます。',
    'Chỉ định điều trị thuộc kỹ thuật này': 'この技術の治療項目',
    'Không có ca nào phù hợp bộ lọc hiện tại.': '条件に合う施術はありません。',
    'Không tìm thấy kỹ thuật phù hợp.': '該当する技術が見つかりません。',
    'Chọn một kỹ thuật để xem nhóm chỉ định điều trị.': '技術を選ぶと治療項目が表示されます。',
    'Chọn một kỹ thuật để xem các chỉ định điều trị.': '技術を選ぶと治療項目が表示されます。',
    'Chưa chọn chỉ định nào. Hãy bấm vào các chỉ định ở bên trái để thêm vào ca điều trị.': '治療項目はまだ選択されていません。左側から追加してください。'
  };
  const filterJp = { all: 'すべて', running: '進行中', waiting: '未開始', late: '開始遅れ', paused: '一時停止', overdue: '施術時間超過', done: '完了' };

  function actionJp(button) {
    switch (button.dataset.action) {
      case 'nav': return button.dataset.view === 'catalog' ? '施術時間表' : 'ダッシュボード';
      case 'open-new': return '新しい施術を作成';
      case 'retry-sync': return '再読み込み';
      case 'filter': return filterJp[button.dataset.filter];
      case 'room-filter': return button.dataset.room === 'all' ? 'すべての部屋' : `治療室${button.dataset.room.slice(-1)}`;
      case 'set-room': return `治療室${button.dataset.room.slice(-1)}`;
      case 'start': return '開始';
      case 'pause': return '一時停止';
      case 'adjust': return button.dataset.val === '-1' ? '1分減らす' : '1分増やす';
      case 'reset': return 'リセット';
      case 'expand': return button.textContent.includes('Ẩn') ? '詳細を閉じる' : '詳細を見る';
      case 'edit': return '編集';
      case 'finish': return '完了';
      case 'delete': return '削除';
      case 'cancel-builder': return button.classList.contains('back-link') ? 'ダッシュボードに戻る' : 'キャンセル';
      case 'back-to-techs': return '技術選択に戻る';
      case 'save-case': return button.textContent.includes('Lưu') ? '変更を保存' : '施術を作成';
      case 'builder-group':
      case 'catalog-group': return button.dataset.group ? groupJp[button.dataset.group] : 'すべて';
      case 'remove-service': return '削除';
      case 'quick-tech': return 'この技術で新規作成';
      default: return '';
    }
  }

  function addLine(element, japanese, className = 'jp-line') {
    if (!japanese) return;
    let line = Array.from(element.children).find(child => child.classList.contains(className) && child.lang === 'ja');
    if (!line) {
      line = document.createElement('span');
      line.className = className;
      line.lang = 'ja';
      element.append(line);
    }
    if (line.textContent !== japanese) line.textContent = japanese;
  }
  function decorateButton(button) {
    if (button.classList.contains('tech-card')) {
      const names = techNames[button.dataset.tech];
      const title = button.querySelector('h3');
      if (title && names) {
        addLine(title, names[0], 'tech-vi-line');
        addLine(title, names[1], 'tech-jp-line');
      }
      const link = button.querySelector('.tech-card-link');
      if (link) addLine(link, button.dataset.action === 'catalog-tech' ? '治療項目を開く' : '治療項目を見る');
      return;
    }
    if (button.classList.contains('ind-row')) {
      const copy = button.querySelector('.ind-copy');
      if (copy && !copy.querySelector('[lang="ja"]')) addLine(copy, serviceJp[button.dataset.service]);
      return;
    }
    const japanese = actionJp(button);
    if (!japanese) return;
    if (button.dataset.action === 'remove-service' && !button.querySelector('.button-vi')) button.textContent = '× Xóa';
    if (!button.querySelector(':scope > .button-vi')) {
      const primary = document.createElement('span');
      primary.className = 'button-vi';
      while (button.firstChild) primary.append(button.firstChild);
      button.append(primary);
    }
    button.classList.add('bilingual-action');
    addLine(button, japanese);
  }
  function plainText(element) {
    return Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ').trim();
  }
  function decorateText(element) {
    const value = plainText(element);
    const count = value.match(/^(\d+) chỉ định(?: điều trị)?$/);
    const minutes = value.match(/^(\d+)(?:[–-](\d+))? phút$/);
    const japanese = textJp[value] || (count ? `${count[1]}件` : '') ||
      (minutes ? `${minutes[1]}${minutes[2] ? `〜${minutes[2]}` : ''}分` : '');
    if (japanese) addLine(element, japanese);
  }
  function decorateSelectedLabel(label) {
    let title = label.querySelector(':scope > .selected-label-text');
    if (!title) {
      title = document.createElement('span');
      title.className = 'selected-label-text';
      for (const node of Array.from(label.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) title.append(node);
      }
      label.prepend(title);
    }
    decorateText(title);
  }
  function decorateDetail(find) {
    find('.detail-head').forEach(head => {
      const names = techNames[head.querySelector('.detail-code')?.textContent.trim()];
      const title = head.querySelector('h2');
      if (title && names) {
        addLine(title, names[0], 'tech-vi-line');
        addLine(title, names[1], 'tech-jp-line');
      }
    });
    find('.selected-item').forEach(item => {
      const id = item.querySelector('[data-action="remove-service"]')?.dataset.service;
      const title = item.querySelector('.selected-head b');
      if (title) addLine(title, serviceJp[id]);
    });
  }
  const textSelector = [
    'h1', '.section-head h2', '.builder-top h1', '.catalog-top h1', '.summary-head h2',
    '.stat-label', '.stat-card small', '.info-chip small', '.timer-box small', '.status',
    '.field > span', '.summary-total small', '.detail-stats small', '.detail-copy p',
    '.soft-pill', '.timeline-top', '.live-pill', '.mode-pill', '.footer span',
    '.section-head p', '.builder-top p', '.catalog-top p', '.hero-copy p', '.eyebrow',
    '.empty-box', '.tech-card-meta span', '.ind-time', '.selected-note', '.info-chip b',
    '.case-summary-info h2', '.summary-facts small', '.summary-facts span', '.room-badge',
    '.room-panel-head h3', '.room-empty',
    '.summary-total b'
  ].join(',');
  function apply(root = document) {
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    const find = selector => [ ...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector) ];
    find('button[data-action]').forEach(decorateButton);
    find(textSelector).forEach(decorateText);
    find('.selected-controls label').forEach(decorateSelectedLabel);
    decorateDetail(find);
    const brand = document.querySelector('#homeLink .brand-copy');
    if (brand) addLine(brand, '治療タイムライン');
  }
  function start() {
    apply();
    const observer = new MutationObserver(records => {
      const targets = new Set();
      for (const record of records) {
        if (record.type !== 'childList') continue;
        if (record.target.matches?.('button[data-action], .jp-line, .tech-vi-line, .tech-jp-line')) continue;
        targets.add(record.target.nodeType === Node.ELEMENT_NODE ? record.target : document);
      }
      targets.forEach(apply);
    });
    observer.observe(document.body, { subtree: true, childList: true });
  }
  return { start, apply };
})();
