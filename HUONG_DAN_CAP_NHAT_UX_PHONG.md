# Cập nhật UX bảng phòng và phân trang ca

1. Dùng ZIP `TBVN_Treatment_Timeline_RoomUX_Netlify_2026-10-30.zip` để triển khai lên **site Netlify hiện tại**. ZIP đã chứa `config.js` với Project URL và publishable key công khai của site hiện tại; không cần tạo site mới.
2. Tải lại trang sau khi Netlify triển khai. Kiểm tra Bảng điều phối 3 phòng; trên điện thoại dùng tab Treatment 1–3.
3. Thử bấm khách trong phòng. Danh sách ca bên dưới sẽ tự mở đúng trang (6 ca/trang), xử lý bộ lọc đang ẩn ca, cuộn tới đúng thẻ và highlight khoảng 1 giây.
4. Kiểm tra với 7 ca trở lên để thấy nút Trước/Sau. Với 6 ca trở xuống, phân trang tự ẩn. Số ca được tính **sau khi lọc và tìm kiếm**.

**Không cần cập nhật Supabase.** Bản này chỉ đổi `app.js`, `styles.css`, `bilingual.js`, `index.html` và tài liệu. Không sửa SQL, dữ liệu ca, đồng hồ hay cấu hình Realtime. Nếu migration `supabase_start_time_upgrade.sql` từ bản thời gian trước chưa được chạy, vẫn cần chạy migration đó trước khi sử dụng các chức năng tạo ca của bản website hiện tại.
