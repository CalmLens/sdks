class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.21.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.21.0/calmlens-0.21.0-darwin-arm64.tar.gz"
      sha256 "fa6c04042c29528d5e5d4bc280fde8bae4a2007648a579c23b20ee0423773fdc"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.21.0/calmlens-0.21.0-darwin-x64.tar.gz"
      sha256 "b4922f457b69376974d0525eab1acb41fa0a6300a2037b2e2cd6817e30ca3096"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.21.0/calmlens-0.21.0-linux-arm64.tar.gz"
      sha256 "ab4ed4b9cdb040b9455bf4f0627e40e1124074af9e2d9a8ee8734dd3fb061d73"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.21.0/calmlens-0.21.0-linux-x64.tar.gz"
      sha256 "378973fac0da83d66f87f7a2be22abfbd2afafe14340e0f11a0a50bd9ec454ce"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
