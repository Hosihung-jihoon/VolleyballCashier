1. Test Khởi tạo & Đồng bộ:

- [x] Host nhập tên và bấm "Tạo phòng mới". Màn hình chuyển sang Session, hiển thị PIN.
- [x] Member mở app, nhập tên và mã PIN của Host -> bấm "Tham gia".
- [x] Kỳ vọng: Tên của Member hiện lên ngay lập tức trên máy Host ở mục "Danh sách chờ".
2. Test Thêm người chơi thủ công:

- [x] Host nhập tên "Nguyễn Văn A" vào ô nhập liệu và bấm dấu +.
- [x] Kỳ vọng: "Nguyễn Văn A" xuất hiện ở Danh sách chờ. Ô nhập liệu bị rỗng. Máy Member cũng thấy tên này.
3. Test Chia đội & Chặn lỗi:

- [x] Host bấm "Bắt đầu Set mới". Giao diện Team A và Team B hiện ra.
- [x] Host bấm "A Thắng" ngay lập tức khi chưa chia người.
- [x] Kỳ vọng: App báo lỗi "Vui lòng chia đủ người cho cả 2 đội!".
- [x] Host bấm vào tên người chờ, chọn "Team A". Làm tương tự cho "Team B" (đảm bảo cả 2 đội có người).
- [x] Host bấm dấu ✖ bên cạnh tên người trong Team để xóa họ ra khỏi đội. Thêm lại họ vào đội khác.
4. Test Tính tiền cơ bản (5 vs 5):

- [x] Host chia 5 người Team A, 5 người Team B.
- [x] Host bấm "A Thắng".
- [x] Kỳ vọng: 5 người Team A được +30.000đ (mỗi người +6.000đ). 5 người Team B bị -30.000đ (mỗi người -6.000đ). Quỹ lẻ = 0đ.
5. Test Tính tiền lệch đội (5 vs 6):

- [x] Host bấm "Set tiếp theo". Chia 5 người Team A, 6 người Team B.
- [x] Host bấm "B Thắng" (Đội 6 người thắng).
- [x] Kỳ vọng:
        Đội B (6 người) nhận: 30.000 / 6 = 5.000đ/người.
        Đội A (5 người) trả: 30.000 / 5 = 6.000đ/người. Tổng thu = 30.000đ. Quỹ lẻ = 0đ.
- [x] Bấm "Hoàn tác" và thử "A Thắng" (Đội 5 người thắng).
- [x] Kỳ vọng:
        Đội A (5 người) nhận: 30.000 / 5 = 6.000đ/người.
        Đội B (6 người) trả: 30.000 / 6 = 5.000đ/người. (Tổng thu = 30.000đ. Quỹ lẻ = 0đ).
6. Test Làm tròn & Quỹ lẻ (4 vs 6):

- [x] Host thêm người thủ công sao cho đủ 4 vs 6. Bấm "A Thắng" (Đội 4 người thắng).
- [x] Kỳ vọng:
        Đội A (4 người) nhận: 30.000 / 4 = 7.500đ. Làm tròn? Không, bên thắng không làm tròn. Mỗi người +7.500đ.
        Đội B (6 người) trả: 30.000 / 6 = 5.000đ. Mỗi người -5.000đ.
        (Lưu ý: Logic làm tròn chỉ áp dụng bên thua nếu total/slots lẻ. VD: 30k/4 = 7500 -> làm tròn 8000).
- [x] Đổi lại: Bấm "B Thắng" (Đội 6 người thắng).
- [x] Kỳ vọng: Đội A (4 người thua): 30.000 / 4 = 7.500đ. Làm tròn lên 8.000đ. Tổng thu = 32.000đ.
        Đội B (6 người thắng): Nhận 32.000 / 6 = 5.333đ/người.
        Quỹ lẻ: 32.000 - 30.000 = 2.000đ.
7. Test Thay người giữa chừng (Substitution):

- [x] Host bắt đầu set mới. Thêm "An" vào Team A, "Bình" vào Team A. Thêm vài người Team B.
- [x] Host bấm vào Slot của "An" (vị trí box màu cam).
- [x] Banner vàng hiện ra: "Đang thay người cho Slot...". Màu của người chờ chuyển sang cam.
- [x] Host bấm vào "Cường" ở danh sách chờ.
- [x] Kỳ vọng: Slot của "An" giờ có cả "An" và "Cường". "Cường" biến mất khỏi danh sách chờ. Banner vàng biến mất.
- [x] Host bấm "A Thắng" (Giả sử Team A có 5 slot, nhưng slot của An+Cường là 1 slot).
- [x] Kỳ vọng: An và Cường chia nhau tiền thắng của slot đó. (VD: Team A 5 slot thắng, 1 slot 6000đ. An được 3000đ, Cường được 3000đ).
8. Test Hoàn tác (Undo):

- [x] Hoàn thành 1 set bất kỳ. Ghi nhớ số dư của mọi người và Quỹ lẻ.
- [x] Bấm "Hoàn tác".
- [x] Kỳ vọng: Số dư của tất cả người chơi ở set vừa rồi quay về 0 (hoặc số dư trước set đó). Quỹ lẻ giảm về đúng mức trước set đó. Trạng thái set đổi từ 'completed' về 'playing'.