# Test cases — Volleyball Cashier (100% Offline)

Quy ước: Cược mặc định 5.000đ/suất. "Số dư" = cột tiền trong mục *Thanh toán & Chốt sổ*.
Các case tính tiền có mã `ENG-xx` được khóa tự động bởi `npm test` (`scripts/check-betting-engine.mjs`).
Đánh dấu **[Smoke]** = chạy kiểm tra nhanh mỗi lần cập nhật.

---

## 1. Màn hình Home (`src/app/index.js`)

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| HOME-01 [Smoke] | Để trống tên, bấm "BẮT ĐẦU BUỔI CHƠI MỚI" | Alert "Lỗi — Vui lòng nhập tên của bạn!", không chuyển màn hình | |
| HOME-02 | Nhập tên "Hùng" -> Bấm "BẮT ĐẦU BUỔI CHƠI MỚI" | Chuyển sang Session với PIN dạng `L-xxxx`, vai trò Host, tên Hùng được lưu tự động | |
| HOME-03 | Đóng app hoàn toàn rồi mở lại | Ô tên vẫn hiển thị "Hùng" (đã lưu vào máy) | |
| HOME-04 [Smoke] | Khi đã có buổi chơi chưa kết thúc, mở app | Xuất hiện nút vàng "Tiếp tục buổi chơi"; bấm vào quay lại đúng phiên chơi cũ | |
| HOME-05 | Bấm "Hướng dẫn luật chơi & tính năng" | Modal cẩm nang hiện; hiển thị đúng quy tắc tiền chẵn và tiền thừa sân; bấm "ĐÃ HIỂU" đóng modal | |
| HOME-06 | Phiên chơi offline cũ đã quá 24h | Tự động dọn dẹp khỏi bộ nhớ máy khi mở Home (`parsed.meta.createdAt`) | |

---

## 2. Quản lý Người chơi & Danh sách chờ

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| PLY-01 [Smoke] | Nhập tên "Nguyễn Văn A" -> Bấm "+" | Tên xuất hiện ở Danh sách chờ, ô nhập rỗng | |
| PLY-02 | Nhập tên rồi bấm Enter/Submit bàn phím | Thêm người thành công như bấm "+" | |
| PLY-03 | Bấm "+" khi ô nhập trống hoặc chỉ có dấu cách | Không thêm, không báo lỗi | |
| PLY-04 | Thêm người trùng tên | Cả 2 được thêm với id riêng biệt, không đè nhau | |
| PLY-05 | Đã chia tất cả người chơi vào các đội | Danh sách chờ hiển thị "Tất cả đã lên sân!" | |

---

## 3. Chia Đội & Chống Trùng Slot

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| SET-01 [Smoke] | Bấm "Bắt đầu" khi chưa có set nào | Tạo Set 1 (`playing`); hiển thị Team A, Team B, Team C (Nghỉ); nút "A Thắng" / "B Thắng" | |
| SET-02 [Smoke] | Chưa chia đủ người cho 2 đội đang đấu -> Bấm "A Thắng" | Báo lỗi "Vui lòng chia đủ người cho Team A và Team B!" | |
| SET-03 | Bấm tên người chờ -> Chọn Team A | Người chơi vào Team A thành 1 slot mới, biến khỏi danh sách chờ | |
| SET-04 | Bấm ✖ bên cạnh tên trong đội | Người chơi quay lại danh sách chờ; slot bị xóa nếu chỉ có 1 người | |
| SET-05 [Smoke] | Đội có 3 slot (slot_1, slot_2, slot_3). Xóa người ở slot_2 -> Thêm người mới | Sinh slot_4 bằng `Math.max()+1`, KHÔNG đè lên slot_3 của người cũ | |

---

## 4. Đa Đội & Matchup

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| TEAM-01 | Bấm ⊕ cạnh dòng Trận đấu | Thêm Đội D thành công; cột Đội D xuất hiện | |
| TEAM-02 | Bấm đổi đội bên Trái ("Team A ▾") | Danh sách chọn không chứa đội đang ở bên Phải | |
| TEAM-03 | Chọn Team C cho bên Trái (thành Team B vs Team C) | Matchup tự động sắp xếp chữ cái; nút thắng đổi thành "B Thắng" / "C Thắng" | |
| TEAM-04 | Đội đang nghỉ và có > 2 đội -> Bấm icon xóa đội | Confirm xóa -> Đội bị xóa, toàn bộ người chơi trong đội về danh sách chờ | |
| TEAM-05 | Trận A vs C kết thúc | `ENG-14`: Đội B nghỉ không bị cộng/trừ tiền | |

---

## 5. Kèo Lệch Người 4 vs 5 & Gánh Suất (Tiền Polymer)

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| BET-01 [Smoke] | Đội A có 4 người, Đội B có 5 người (chưa gán cược) | Banner Payout hiện số tiền chuẩn xác 100%: Team A thắng nhận `+7.000đ / +6.000đ` (`ENG-21`), Team B thắng nhận `+4.000đ` (`ENG-22`), không bao giờ hiện 1k, 2k | |
| BET-02 [Smoke] | Bấm vào A1 -> Nhập 10.000đ (gánh 2 slot) -> Bấm Lưu | Hai đội cân tiền 25k vs 25k ➔ Banner Payout tự động biến mất | |
| BET-03 [Smoke] | Trận 5 vs 5 bình thường (đã cân tiền) | Banner Payout không hiển thị | |
| BET-04 [Smoke] | Team A thắng (kèo 4v5 có A1 gánh 10k) | `ENG-16`: B mỗi người -5.000đ. A1 nhận đúng +10.000đ, 3 người còn lại nhận +5.000đ (Zero-sum, tiền chẵn 100%) | |
| BET-05 | Team B thắng (kèo 4v5 có A1 gánh 10k) | `ENG-17`: A1 trả đúng -10.000đ, 3 người A còn lại trả -5.000đ. B mỗi người nhận +5.000đ (Zero-sum, tiền chẵn 100%) | |
| BET-06 | 1-on-1: A1 cược riêng 20k với B1 (5v5) | `ENG-10` & `ENG-11`: A1 và B1 thanh toán trực tiếp 20k, các vị trí còn lại chia đều mức cược 5k | |
| BET-07 [Smoke] | 2 vs 1: Đội A có A1, A2; Đội B có B1. B1 cược 10k và chọn đối thủ A1 | `ENG-19` & `ENG-20`: A thắng -> A1 5k, A2 5k, B1 -10k. A2 không bao giờ bị 0đ | |

---

## 6. Thay Người Giữa Set

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| SUB-01 | Bấm vào ô slot của An trong Team A | Banner "Thay người Slot... Chọn người chờ!" hiện lên | |
| SUB-02 | Bấm vào Cường ở danh sách chờ | Slot thành "An & Cường"; Cường rời danh sách chờ | |
| SUB-03 | Team A thắng (slot An+Cường) | `ENG-06`: An và Cường chia đôi tiền thắng của slot đó | |
| SUB-04 | Team A thua (slot An+Cường) | `ENG-07`: Mức thua 2.500đ làm tròn lên 3.000đ/người | |
| SUB-05 | Bấm ✖ cạnh tên Cường trong slot đôi | Chỉ Cường ra ngoài, An vẫn giữ slot | |

---

## 7. Chỉnh Sửa Set Đấu Trong Lịch Sử & Hoàn Tác

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| UNDO-01 [Smoke] | Bấm "A Thắng" -> Ghi nhận số dư -> Bấm "Hoàn tác" ở footer chính | Số dư hoàn lại 100% chuẩn xác dựa theo snapshot `balanceChanges` đã lưu | |
| UNDO-02 [Smoke] | Vào Lịch sử bấm xem 1 set cũ (Team A thắng) -> Bấm "Chỉnh sửa: Đổi sang Team B thắng" | Alert xác nhận -> Đồng ý: Đội thắng đổi sang Team B, số dư đảo chiều đúng, set hiển thị tag cam `[Đã sửa]`, set vẫn giữ `completed` không bị biến thành `playing` | |
| UNDO-03 [Smoke] | Mở lại set đó và đổi lại sang Team A thắng (về kết quả ban đầu) | Tag `[Đã sửa]` biến mất vì kết quả đã trùng với `originalWinner` ban đầu | |
| UNDO-04 | Sắp xếp lịch sử sau khi chỉnh sửa | Danh sách vẫn giữ nguyên thứ tự set cố định (Set 3, Set 2, Set 1), không nhảy xáo trộn | |

---

## 8. Kèo Phụ (Side Match)

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| SIDE-01 [Smoke] | Bấm dropdown -> "+ Thêm kèo phụ mới" -> Nhập tên "Đôi công", cược 10.000đ | Tạo kèo phụ thành công, tự tạo set 1 riêng cho kèo phụ | |
| SIDE-02 | Chia đội và bấm thắng trong kèo phụ | Tiền cược kèo phụ cộng dồn vào số dư chung của từng người chơi | |
| SIDE-03 | Chuyển qua lại giữa Trận chính và Kèo phụ | Mỗi bên giữ nguyên đội hình, ô cược và set đấu độc lập | |
| SIDE-04 | Xóa kèo phụ | Hoàn trả toàn bộ số dư của các set trong kèo phụ đó | |

---

## 9. Kết Thúc Buổi Chơi & Tiền Thừa Sân (Bỏ Quỹ)

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| CF-01 [Smoke] | Bấm "Kết thúc buổi" -> Nhập tiền sân 200.000đ, 17 người, Chia đều | `ENG-18`: Mỗi người đóng 12.000đ (`Math.ceil`). Tổng thu 204.000đ. Tiền thừa 4.000đ | |
| CF-02 [Smoke] | Quan sát Header & Banner kết thúc | Header hiện chip xanh `Thừa: 4.000đ`. Banner ghi rõ `Tổng tiền sân: 200.000đ. Tiền thừa: 4.000đ.` | |
| CF-03 | Bấm "Hoàn tác kết thúc buổi chơi" | Khôi phục lại buổi chơi, hoàn trả tiền sân cho từng người, chip tiền thừa biến mất | |
| CF-04 | Chia theo số set đã đấu | Người chơi nhiều set trả theo tỷ lệ, làm tròn lên 1.000đ cho mỗi người | |

---

## 10. Chốt Sổ & Sổ Cái Cá Nhân

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| LED-01 [Smoke] | Bấm nút "Thu" cạnh người đã trả tiền | Dòng người chơi gạch ngang mờ, nút đổi thành "Sửa", thanh tiến độ tăng % | |
| LED-02 | Bấm vào tên người chơi trong bảng thanh toán | Modal Sổ cái mở ra, liệt kê chi tiết từng set/kèo phụ và số tiền cộng/trừ tương ứng | |

---

## 11. Định Dạng Tiền Tệ '.' (Phân Biệt Hàng Nghìn)

| ID | Bước thực hiện | Kết quả kỳ vọng | Kết quả |
|---|---|---|---|
| UI-01 [Smoke] | Gõ `10000` vào ô tiền cược ở footer | Ô input tự động hiển thị `10.000` phân cách dấu chấm rõ ràng | |
| UI-02 [Smoke] | Gõ `200000` vào ô tổng tiền sân | Ô input tự động hiển thị `200.000` | |
| UI-03 | Gõ `10000` vào ô cược riêng cá nhân | Ô input tự động hiển thị `10.000` | |
| UI-04 | Quan sát badge cược riêng trên cột đội | Hiển thị dạng `(10.000đ)` thay vì `10k` | |
