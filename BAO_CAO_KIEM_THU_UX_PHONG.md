# Báo cáo kiểm thử UX bảng phòng — 30/10/2026

| Tình huống | Kết quả |
|---|---|
| 1 phòng có 1, 5, 20 khách; 3 phòng khác số; phòng trống | Card gọn; phòng 20 khách giới hạn 550px; empty state đúng |
| Cuộn Phòng 1 | Phòng 2 giữ vị trí cuộn riêng |
| 6 ca trong Danh sách ca | Hiện 6 card, ẩn phân trang |
| 7 ca trong Danh sách ca | Hiện 6 card và nút Trước/Sau |
| 25 ca, bấm khách cuối trong phòng | Mở trang 4, đúng thẻ UUID, URL/route không đổi |
| Hai khách trùng tên | Chọn đúng UUID, không dựa vào tên |
| Bộ lọc phòng/trạng thái và tìm kiếm đang ẩn ca | Chỉ nới các điều kiện cần thiết, rồi mở đúng trang |
| Click hai khách liên tiếp | Chỉ card được chọn sau cùng nhận highlight |
| Highlight | Tự tắt sau khoảng 1 giây; không đổi dữ liệu ca |
| Ca bị xóa khi đang cuộn | Không có lỗi; hiển thị thông báo phù hợp |
| Thứ tự ưu tiên | Quá giờ chạy → đang chạy → tạm dừng → trễ bắt đầu → chưa trễ; ca hoàn tất ẩn khỏi phòng |
| Đồng hồ phòng và thẻ ca | Cùng giá trị từ `caseLeft` trên cùng dữ liệu ca |
| Desktop 1440px, tablet 900px, mobile 390px | 3/2/1 cột; mobile có tab phòng; không tràn ngang trang |
| Bàn phím | Card là nút thật; Enter kích hoạt và có focus state |
| Console trên bản thử cô lập | 0 lỗi JavaScript |
| Cú pháp | `node --check app.js` và `node --check bilingual.js` đạt |

Realtime: kiểm tra mã `loadCases` và subscription vẫn dùng cùng `state.cases`; thử render lại dữ liệu giả lập giữ vị trí cuộn của phòng. **Chưa kiểm thử Realtime thực tế trên hai thiết bị hoặc thao tác điều trị trên Supabase thật** trong lượt này. Các hàm tạo, sửa, ±1 phút, hoàn tất và đồng hồ không bị chỉnh sửa.
