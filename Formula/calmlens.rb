class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.26.1"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.1/calmlens-0.26.1-darwin-arm64.tar.gz"
      sha256 "6386e7e22b4177ac2c2d89cc821942bcd0d149a0e3f9f5cc451abdbe9fd59645"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.1/calmlens-0.26.1-darwin-x64.tar.gz"
      sha256 "1bbead0730ed7e7e30b811ecb25b6f328d605d2ac13f14d2d347e0ba660b7a05"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.1/calmlens-0.26.1-linux-arm64.tar.gz"
      sha256 "df38cdd21c1c62350848abd90bb0482e2bfaeab306b5bbcf7e56928865cbff3f"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.1/calmlens-0.26.1-linux-x64.tar.gz"
      sha256 "3a58667f40d414fdf1638fc8ebe1d23800bc53bfda97dc69683da1793035ba97"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
