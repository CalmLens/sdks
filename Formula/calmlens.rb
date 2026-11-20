class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.3"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.3/calmlens-0.27.3-darwin-arm64.tar.gz"
      sha256 "d5856595792741ecf07ceccd140e3374f4e9c50513da30f644ad9bc66b51cf75"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.3/calmlens-0.27.3-darwin-x64.tar.gz"
      sha256 "b82e63b97b8ff86e3d2d2c9804bee7d77f75a1d328b1d84e209a5e9abb8742b1"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.3/calmlens-0.27.3-linux-arm64.tar.gz"
      sha256 "55766ae1922338712217d8aac3b56dd636c141044b243bf83b3edb52693be331"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.3/calmlens-0.27.3-linux-x64.tar.gz"
      sha256 "0fe596a4911bf9c4a9f252b6a771ebc0fee612dac7549b6da71f4c9b7390b665"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
