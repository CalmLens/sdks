class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.4"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.4/calmlens-0.27.4-darwin-arm64.tar.gz"
      sha256 "5c2063921d17b01a694d2be97691aa9898943fa842f4a616067c9215172b13f2"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.4/calmlens-0.27.4-darwin-x64.tar.gz"
      sha256 "eeba6f2547eaa7c69bdc131097d6f91fd432034143b50e09747a81205c2cdffd"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.4/calmlens-0.27.4-linux-arm64.tar.gz"
      sha256 "4231b1e70f4e6f0fb7b9e0e57a9a3182bc707e077a23aa9d703796ed943da80b"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.4/calmlens-0.27.4-linux-x64.tar.gz"
      sha256 "21f2602a258b28802f17837bafc6a5553ece38925a54e22930199a96b9259bfe"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
